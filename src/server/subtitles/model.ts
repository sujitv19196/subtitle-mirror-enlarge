import type { CueKind, Line } from "../../shared/protocol.ts";

export type SubFormat = "srt" | "vtt" | "ass";

/** An event as written in the file. Parsers produce these without interpreting them. */
export interface SubEvent {
  start: number;
  end: number;
  /** Empty for drawing-only events. */
  lines: Line[];
  /** Original text including tags. */
  rawText: string;

  /** ASS/SSA only. */
  style?: string;
  actor?: string;
  effect?: string;
  layer?: number;

  /** \pos or \move */
  positioned: boolean;
  /** \k, \kf, \ko, \K */
  karaoke: boolean;
  /** \p1+ vector drawing */
  drawing: boolean;
}

/** A tuned cue, before merging and id assignment. */
export interface RawCue {
  start: number;
  end: number;
  kind: CueKind;
  lines: Line[];
}

export interface TuneContext {
  format: SubFormat;
  path: string;
}

/** Interprets parsed events for a kind of content: assigns CueKind and drops what shouldn't show. */
export interface Tuner {
  id: string;
  description: string;
  tune(events: readonly SubEvent[], ctx: TuneContext): RawCue[];
}
