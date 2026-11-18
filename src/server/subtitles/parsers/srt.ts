import type { SubEvent } from "../model.ts";
import { parseMarkupLines, plainEvent } from "../text.ts";

/** 00:01:02,345 — also tolerates '.' and short fields. */
const TS = /(\d+):(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/;

export function parseSrtTime(s: string): number | null {
  const m = TS.exec(s);
  if (!m) return null;
  const ms = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

export function parseSrt(text: string): SubEvent[] {
  const events: SubEvent[] = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split("\n");
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, b] = lines[ti]!.split("-->");
    const start = parseSrtTime(a ?? "");
    const end = parseSrtTime(b ?? "");
    if (start == null || end == null) continue;
    const body = lines.slice(ti + 1).filter((l) => l.trim() !== "");
    events.push(plainEvent(start, end, body.join("\n"), parseMarkupLines(body)));
  }
  return events;
}
