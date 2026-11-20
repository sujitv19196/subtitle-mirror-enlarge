import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { discoverSubtitles, episodeKey } from "../../src/server/subtitles/discover.ts";

const root = mkdtempSync(join(tmpdir(), "submirror-discover-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function tree(files: string[]): string {
  const dir = join(root, String(n++));
  for (const f of files) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "");
  }
  return dir;
}

/** Relative paths with "/" so expectations read the same on Windows. */
const found = (dir: string, video: string) => discoverSubtitles(join(dir, video)).map((p) => relative(dir, p).replaceAll(sep, "/"));

test("name matches, excluding other videos' subs", () => {
  const dir = tree(["Show S01E01.mkv", "Show S01E02.mkv", "Show S01E01.ja.srt", "Show S01E01.en.ass", "Show S01E02.en.srt"]);
  expect(found(dir, "Show S01E01.mkv")).toEqual(["Show S01E01.en.ass", "Show S01E01.ja.srt"]);
});

test("Subs/ and Subs/<video name>/ layouts", () => {
  const dir = tree(["Movie.mkv", "Other.mkv", "Subs/Movie/2_English.srt", "Subs/Movie/10_French.srt", "Subs/Unrelated.srt"]);
  expect(found(dir, "Movie.mkv")).toEqual(["Subs/Movie/2_English.srt", "Subs/Movie/10_French.srt"]);
});

test("episode number match when release names differ", () => {
  const dir = tree(["[A] Show - 03 [1080p].mkv", "[A] Show - 04 [1080p].mkv", "[B] Show - 03.ass", "[B] Show - 04.ass"]);
  expect(found(dir, "[A] Show - 03 [1080p].mkv")).toEqual(["[B] Show - 03.ass"]);
});

test("single video in folder takes every subtitle", () => {
  const dir = tree(["Film.mp4", "track1.srt", "Subtitles/track2.vtt"]);
  expect(found(dir, "Film.mp4")).toEqual(["Subtitles/track2.vtt", "track1.srt"]);
});

test("nothing found", () => {
  expect(found(tree(["A.mkv", "B.mkv", "C.srt"]), "A.mkv")).toEqual([]);
});

test("episodeKey", () => {
  expect(episodeKey("Show.S02E05.1080p")).toBe("s2e5");
  expect(episodeKey("[Grp] Show - 12v2 [720p]")).toBe("e12");
  expect(episodeKey("Show - 07")).toBe("e7");
  expect(episodeKey("Movie (2020)")).toBeNull();
});
