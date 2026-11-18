/** Wire protocol. Media times are seconds; wall-clock timestamps are epoch ms. */

export type CueKind = "dialogue" | "sign" | "song";

/** Text with uniform styling. */
export interface Run {
  t: string;
  /** italic */
  i?: true;
}
export type Line = Run[];

export interface Cue {
  id: number;
  start: number;
  end: number;
  kind: CueKind;
  lines: Line[];
}

export interface Track {
  /** Bumped whenever the cue list changes. */
  generation: number;
  path: string | null;
  format: string | null;
  cues: Cue[];
  error?: string;
}

/** Snapshot of the playback clock; clients extrapolate from it until the next one. */
export interface PlaybackState {
  seq: number;
  /** Media time at serverTs. */
  mediaTime: number;
  serverTs: number;
  rate: number;
  /** Paused, seeking or buffering. */
  frozen: boolean;
  /** Positive = subtitles shown later. */
  subDelay: number;
}

export type ServerMsg =
  | { type: "hello"; version: 1 }
  | { type: "track"; track: Track }
  | { type: "state"; state: PlaybackState }
  | { type: "pong"; t0: number; ts: number }
  | { type: "ended" };

export type ClientMsg =
  | { type: "ping"; t0: number }
  /** Cues that just became visible; ts is in server clock. */
  | { type: "rendered"; generation: number; cueIds: number[]; ts: number };

export function mediaTimeAt(state: PlaybackState, serverNowMs: number): number {
  if (state.frozen) return state.mediaTime;
  return state.mediaTime + ((serverNowMs - state.serverTs) / 1000) * state.rate;
}

const MAX_CUE_SECONDS = 600;

/** Cues active at media time t. Cues must be sorted by start. */
export function activeCues(cues: readonly Cue[], t: number, subDelay: number): Cue[] {
  const st = t - subDelay;
  const out: Cue[] = [];
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cues[mid]!.start <= st) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) {
    const c = cues[i]!;
    if (c.end > st) out.push(c);
    if (st - c.start > MAX_CUE_SECONDS) break;
  }
  return out.reverse();
}

export function cuePlainText(cue: Pick<Cue, "lines">): string {
  return cue.lines.map((l) => l.map((r) => r.t).join("")).join("\n");
}

/** Whitespace/case-insensitive form for comparing against mpv's sub-text. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}
