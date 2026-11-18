import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG, run } from "../src/server/embedded/bin.ts";
import { extractTrack, isTextTrack, listSubtitleTracks } from "../src/server/embedded/index.ts";
import { FANSUB_ASS } from "./subtitles/fixtures.ts";

const dir = mkdtempSync(join(tmpdir(), "submirror-embedded-"));
const video = join(dir, "ep.mkv");
const cache = join(dir, "cache");

beforeAll(async () => {
  writeFileSync(join(dir, "a.srt"), "1\n00:00:00,100 --> 00:00:00,900\nHello\n");
  writeFileSync(join(dir, "b.ass"), FANSUB_ASS);
  await run(FFMPEG, [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=16x16:d=1",
    "-i", join(dir, "a.srt"),
    "-i", join(dir, "b.ass"),
    "-i", join(dir, "a.srt"),
    "-map", "0", "-map", "1", "-map", "2", "-map", "3",
    "-c:v", "mpeg4", "-c:s:0", "srt", "-c:s:1", "copy", "-c:s:2", "srt",
    "-metadata:s:s:0", "language=eng", "-metadata:s:s:0", "title=Dialogue",
    "-metadata:s:s:1", "language=eng", "-metadata:s:s:1", "title=Signs & Songs",
    "-disposition:s:0", "default", "-disposition:s:2", "forced",
    video,
  ]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("lists subtitle tracks with metadata", async () => {
  const tracks = await listSubtitleTracks(video);
  expect(tracks).toEqual([
    { index: 1, codec: "subrip", lang: "eng", title: "Dialogue", default: true, forced: false },
    { index: 2, codec: "ass", lang: "eng", title: "Signs & Songs", default: false, forced: false },
    { index: 3, codec: "subrip", lang: undefined, title: undefined, default: false, forced: true },
  ]);
  expect(tracks.every(isTextTrack)).toBe(true);
});

test("extracts a track with its native format, and reuses the cache", async () => {
  const [srt, ass] = await listSubtitleTracks(video);
  const srtPath = await extractTrack(video, srt!, cache);
  expect(srtPath.endsWith(".srt")).toBe(true);
  expect(readFileSync(srtPath, "utf8")).toContain("Hello");

  const assPath = await extractTrack(video, ass!, cache);
  expect(assPath.endsWith(".ass")).toBe(true);
  expect(readFileSync(assPath, "utf8")).toContain("[Events]");

  const mtime = statSync(assPath).mtimeMs;
  expect(await extractTrack(video, ass!, cache)).toBe(assPath);
  expect(statSync(assPath).mtimeMs).toBe(mtime);
});

test("image-based tracks are rejected", async () => {
  expect(extractTrack(video, { index: 9, codec: "hdmv_pgs_subtitle", default: false, forced: false }, cache)).rejects.toThrow(
    /image-based/,
  );
});
