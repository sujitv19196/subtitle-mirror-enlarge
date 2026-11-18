import type { Cue, Line, Run } from "../../shared/protocol.ts";
import type { RawCue, SubEvent } from "./model.ts";

/** A SubEvent for formats without ASS-style fields or override tags. */
export function plainEvent(start: number, end: number, rawText: string, lines: Line[]): SubEvent {
  return { start, end, lines, rawText, positioned: false, karaoke: false, drawing: false };
}

/** Decode a subtitle file honoring BOMs. Falls back to UTF-8 (lossy). */
export function decode(buf: Uint8Array): string {
  let text: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder("utf-16le").decode(buf.subarray(2));
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = new TextDecoder("utf-16be").decode(buf.subarray(2));
  else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = new TextDecoder().decode(buf.subarray(3));
  else text = new TextDecoder().decode(buf);
  return text.replace(/\r\n?/g, "\n");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Accumulates styled lines, merging adjacent runs with equal style. */
export class LineBuilder {
  private lines: Line[] = [[]];

  text(t: string, italic: boolean): void {
    if (!t) return;
    const line = this.lines[this.lines.length - 1]!;
    const last = line[line.length - 1];
    if (last && !!last.i === italic) last.t += t;
    else line.push(italic ? { t, i: true } : { t });
  }

  newline(): void {
    this.lines.push([]);
  }

  build(): Line[] {
    return this.lines
      .map((l) => trimLine(l))
      .filter((l) => l.length > 0);
  }
}

function trimLine(line: Run[]): Run[] {
  const out = line.map((r) => ({ ...r }));
  if (out[0]) out[0].t = out[0].t.replace(/^[ \t]+/, "");
  const last = out[out.length - 1];
  if (last) last.t = last.t.replace(/[ \t]+$/, "");
  return out.filter((r) => r.t.length > 0);
}

/** SRT/VTT cue text: keeps italics, strips other HTML-ish tags and stray ASS overrides. */
export function parseMarkupLines(rawLines: string[]): Line[] {
  const b = new LineBuilder();
  let italic = false;
  rawLines.forEach((raw, idx) => {
    if (idx > 0) b.newline();
    const re = /<\/?([a-zA-Z]+|\d[\d:.]*)[^>]*>|\{\\[^}]*\}|&(#\d+|[a-zA-Z]+);/g;
    let pos = 0;
    for (let m; (m = re.exec(raw)); ) {
      b.text(raw.slice(pos, m.index), italic);
      pos = re.lastIndex;
      const tok = m[0];
      if (tok.startsWith("&")) {
        const ent = m[2]!;
        const ch = ent.startsWith("#") ? String.fromCodePoint(Number(ent.slice(1))) : ENTITIES[ent.toLowerCase()];
        b.text(ch ?? tok, italic);
      } else if (tok.startsWith("{")) {
        const im = /\\i([01])/.exec(tok);
        if (im) italic = im[1] === "1";
      } else if (m[1]?.toLowerCase() === "i") {
        italic = !tok.startsWith("</");
      }
    }
    b.text(raw.slice(pos), italic);
  });
  return b.build();
}

/** Sorts, drops empty cues, and merges contiguous identical ones (layered borders, frame-by-frame signs). */
export function mergeAndNumber(raw: RawCue[]): Cue[] {
  const sorted = raw
    .filter((c) => c.lines.length > 0 && c.end > c.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: RawCue[] = [];
  const lastByKey = new Map<string, RawCue>();
  for (const c of sorted) {
    const key = c.kind + "\u0000" + JSON.stringify(c.lines);
    const prev = lastByKey.get(key);
    if (prev && c.start <= prev.end + 0.05) {
      prev.end = Math.max(prev.end, c.end);
      continue;
    }
    const copy = { ...c };
    out.push(copy);
    lastByKey.set(key, copy);
  }
  return out.map((c, id) => ({ id, ...c }));
}
