import type { Tuner } from "../model.ts";
import { animeTuner } from "./anime.ts";
import { genericTuner } from "./generic.ts";

export const TUNERS: readonly Tuner[] = [genericTuner, animeTuner];
export const DEFAULT_TUNER = genericTuner;

export function getTuner(id: string): Tuner {
  const t = TUNERS.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown tuner "${id}". Available: ${TUNERS.map((t) => t.id).join(", ")}`);
  return t;
}

export { animeTuner, genericTuner };
