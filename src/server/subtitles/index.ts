import type { Cue } from "../../shared/protocol.ts";
import type { SubFormat, Tuner } from "./model.ts";
import { detectFormat, parseEvents } from "./parsers/index.ts";
import { decode, mergeAndNumber } from "./text.ts";
import { DEFAULT_TUNER } from "./tuners/index.ts";

export type { SubEvent, SubFormat, Tuner } from "./model.ts";
export { DEFAULT_TUNER, getTuner, TUNERS } from "./tuners/index.ts";
export { discoverSubtitles } from "./discover.ts";

export interface ParsedSubtitles {
  format: SubFormat;
  cues: Cue[];
}

/** decode → detect format → parse → tune → merge. */
export function parseSubtitles(path: string, bytes: Uint8Array, tuner: Tuner = DEFAULT_TUNER): ParsedSubtitles {
  const text = decode(bytes);
  const format = detectFormat(path, text);
  if (!format) throw new Error(`Unrecognized subtitle format: ${path}`);
  const events = parseEvents(format, text);
  return { format, cues: mergeAndNumber(tuner.tune(events, { format, path })) };
}

export async function loadSubtitles(path: string, tuner: Tuner = DEFAULT_TUNER): Promise<ParsedSubtitles> {
  return parseSubtitles(path, new Uint8Array(await Bun.file(path).arrayBuffer()), tuner);
}
