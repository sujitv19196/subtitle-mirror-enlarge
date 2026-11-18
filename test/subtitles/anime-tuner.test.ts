import { describe, expect, test } from "bun:test";
import { getTuner, parseSubtitles } from "../../src/server/subtitles/index.ts";
import { classifyAnime } from "../../src/server/subtitles/tuners/anime.ts";
import type { SubEvent } from "../../src/server/subtitles/model.ts";
import { cuePlainText } from "../../src/shared/protocol.ts";
import { enc, FANSUB_ASS } from "./fixtures.ts";

const ev = (over: Partial<SubEvent>): SubEvent => ({
  start: 0,
  end: 1,
  lines: [[{ t: "x" }]],
  rawText: "x",
  positioned: false,
  karaoke: false,
  drawing: false,
  ...over,
});

describe("classifyAnime", () => {
  test.each([
    [{ style: "Default" }, "dialogue"],
    [{ style: "Default", positioned: true }, "sign"],
    [{ style: "Signs" }, "sign"],
    [{ style: "TS-Title" }, "sign"],
    [{ style: "Default", effect: "Banner;20" }, "sign"],
    [{ style: "OP-Romaji" }, "song"],
    [{ style: "ED_eng" }, "song"],
    [{ style: "Default", karaoke: true, positioned: true }, "song"],
    [{ style: "OP", effect: "fx" }, null],
    [{ style: "Shopkeeper" }, "dialogue"],
  ] as const)("%o → %s", (over, kind) => {
    expect(classifyAnime(ev(over))).toBe(kind);
  });
});

describe("anime tuner pipeline", () => {
  const { cues } = parseSubtitles("show.ass", enc(FANSUB_ASS), getTuner("anime"));

  test("frame-by-frame positioned sign collapses into one sign cue", () => {
    const signs = cues.filter((c) => c.kind === "sign");
    expect(signs).toHaveLength(1);
    expect(signs[0]).toMatchObject({ start: 6, end: 6.12 });
    expect(cuePlainText(signs[0]!)).toBe("CLOSED");
  });

  test("karaoke kept as one song line; fx dropped", () => {
    const songs = cues.filter((c) => c.kind === "song");
    expect(songs).toHaveLength(1);
    expect(cuePlainText(songs[0]!)).toBe("kokoro");
  });

  test("dialogue untouched", () => {
    expect(cues.filter((c) => c.kind === "dialogue").map((c) => c.start)).toEqual([1, 4, 13]);
  });
});

test("getTuner rejects unknown ids", () => {
  expect(() => getTuner("nope")).toThrow(/Available: generic, anime/);
});
