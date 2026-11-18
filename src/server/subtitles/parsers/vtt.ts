import type { SubEvent } from "../model.ts";
import { parseMarkupLines, plainEvent } from "../text.ts";

/** mm:ss.ttt or hh:mm:ss.ttt */
const TS = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;

export function parseVttTime(s: string): number | null {
  const m = TS.exec(s);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

export function parseVtt(text: string): SubEvent[] {
  const events: SubEvent[] = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split("\n");
    const head = lines[0]?.trim() ?? "";
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(head)) continue;
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, rest] = lines[ti]!.split("-->");
    const start = parseVttTime(a ?? "");
    const end = parseVttTime(rest ?? "");
    if (start == null || end == null) continue;
    const body = lines.slice(ti + 1).filter((l) => l.trim() !== "");
    events.push(plainEvent(start, end, body.join("\n"), parseMarkupLines(body)));
  }
  return events;
}
