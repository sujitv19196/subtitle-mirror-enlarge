import { extname } from "node:path";
import type { SubEvent, SubFormat } from "../model.ts";
import { parseAss } from "./ass.ts";
import { parseSrt } from "./srt.ts";
import { parseVtt } from "./vtt.ts";

const PARSERS: Record<SubFormat, (text: string) => SubEvent[]> = {
  srt: parseSrt,
  vtt: parseVtt,
  ass: parseAss,
};

export function detectFormat(path: string, text: string): SubFormat | null {
  const ext = extname(path).toLowerCase();
  if (ext === ".srt") return "srt";
  if (ext === ".vtt" || ext === ".webvtt") return "vtt";
  if (ext === ".ass" || ext === ".ssa") return "ass";
  const head = text.slice(0, 4096);
  if (/^\s*WEBVTT/.test(head)) return "vtt";
  if (/\[Script Info\]/i.test(head)) return "ass";
  if (head.includes("-->")) return "srt";
  return null;
}

export function parseEvents(format: SubFormat, text: string): SubEvent[] {
  return PARSERS[format](text);
}
