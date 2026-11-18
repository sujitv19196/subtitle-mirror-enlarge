import type { CueKind } from "../../../shared/protocol.ts";
import type { RawCue, SubEvent, Tuner } from "../model.ts";

export const SIGN_STYLE = /sign|title|typeset|^ts\b|screen|note|eyecatch|logo|preview|card|insert ?text/i;
export const SONG_STYLE = /(^|[^a-z])(op|ed)([^a-z]|$)|song|lyric|kara|opening|ending|romaji/i;
const SIGN_EFFECT = /^(banner|scroll)/i;
/** Karaoke-template output: one event per syllable. */
const FX_EFFECT = /^fx$/i;

export function classifyAnime(e: SubEvent): CueKind | null {
  if (e.effect && FX_EFFECT.test(e.effect)) return null;
  const style = e.style ?? "";
  // OP/ED lyrics are often \pos'd, so check songs first.
  if (e.karaoke || SONG_STYLE.test(style)) return "song";
  if (e.positioned || SIGN_STYLE.test(style) || (e.effect && SIGN_EFFECT.test(e.effect))) return "sign";
  return "dialogue";
}

/** Anime fansub ASS: splits dialogue, signs/typesetting and OP/ED lyrics. */
export const animeTuner: Tuner = {
  id: "anime",
  description: "Anime fansub ASS: separates signs/typesetting and OP/ED lyrics from dialogue; drops karaoke fx.",
  tune(events) {
    const out: RawCue[] = [];
    for (const e of events) {
      const kind = classifyAnime(e);
      if (kind) out.push({ start: e.start, end: e.end, kind, lines: e.lines });
    }
    return out;
  },
};
