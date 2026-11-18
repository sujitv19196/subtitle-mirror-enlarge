import type { Tuner } from "../model.ts";

/** Everything is dialogue. */
export const genericTuner: Tuner = {
  id: "generic",
  description: "Every event with text is dialogue. No content heuristics.",
  tune: (events) =>
    events.map((e) => ({ start: e.start, end: e.end, kind: "dialogue" as const, lines: e.lines })),
};
