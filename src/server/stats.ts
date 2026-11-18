import { normalizeText } from "../shared/protocol.ts";

interface Truth {
  norm: string;
  ts: number;
}
interface Render {
  norm: string;
  ts: number;
}

export interface Summary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const MATCH_WINDOW_MS = 3000;
const TRANSITION_WINDOW_MS = 1000;

/**
 * Phone render time minus mpv's sub-text change time (positive = phone late).
 * Samples near a seek/pause/speed change go in `transition`; they include a network hop by design.
 */
export class LatencyStats {
  private truths: Truth[] = [];
  private renders: Render[] = [];
  private discontinuities: number[] = [];
  readonly steady: number[] = [];
  readonly transition: number[] = [];

  truth(text: string, ts: number): void {
    const norm = normalizeText(text);
    if (!norm) return;
    this.truths.push({ norm, ts });
    if (this.truths.length > 500) this.truths.shift();
  }

  rendered(texts: string[], ts: number): void {
    for (const t of texts) {
      const norm = normalizeText(t);
      if (norm) this.renders.push({ norm, ts });
    }
    if (this.renders.length > 500) this.renders.splice(0, this.renders.length - 500);
  }

  discontinuity(ts: number): void {
    this.discontinuities.push(ts);
    if (this.discontinuities.length > 200) this.discontinuities.shift();
  }

  /** Pairs renders with truths; unmatched renders expire after the window. */
  flush(now: number): void {
    const keep: Render[] = [];
    for (const r of this.renders) {
      let best: Truth | null = null;
      for (const tr of this.truths) {
        // sub-text joins all simultaneous lines.
        if (!tr.norm.includes(r.norm)) continue;
        if (Math.abs(r.ts - tr.ts) > MATCH_WINDOW_MS) continue;
        if (!best || Math.abs(r.ts - tr.ts) < Math.abs(r.ts - best.ts)) best = tr;
      }
      if (best) {
        const delta = r.ts - best.ts;
        const nearDisc = this.discontinuities.some((d) => Math.abs(best!.ts - d) < TRANSITION_WINDOW_MS);
        (nearDisc ? this.transition : this.steady).push(delta);
        this.truths = this.truths.filter((t) => t !== best);
      } else if (now - r.ts < MATCH_WINDOW_MS) {
        keep.push(r);
      }
    }
    this.renders = keep;
  }

  static summarize(xs: number[]): Summary | null {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
    return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0) };
  }

  report(): { steady: Summary | null; transition: Summary | null } {
    return { steady: LatencyStats.summarize(this.steady), transition: LatencyStats.summarize(this.transition) };
  }

  format(): string {
    const f = (name: string, s: Summary | null) =>
      s ? `${name} n=${s.n} p50=${ms(s.p50)} p95=${ms(s.p95)} p99=${ms(s.p99)} worst=${ms(s.max)}` : `${name} n=0`;
    const r = this.report();
    return `latency (phone − mpv): ${f("steady", r.steady)} | ${f("transition", r.transition)}`;
  }
}

const ms = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(0)}ms`;
