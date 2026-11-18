import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG, run } from "./bin.ts";
import { TEXT_CODECS, type EmbeddedTrack } from "./probe.ts";

export const DEFAULT_CACHE_DIR = join(tmpdir(), "submirror-tracks");

/**
 * Extracts a text subtitle track to a file, cached by video path/size/mtime + track.
 * ffmpeg reads the whole container to do this, so large remuxes take a few seconds the first time.
 */
export async function extractTrack(videoPath: string, track: EmbeddedTrack, cacheDir = DEFAULT_CACHE_DIR): Promise<string> {
  const codec = TEXT_CODECS[track.codec];
  if (!codec) throw new Error(`track ${track.index} is ${track.codec}, which is image-based and can't be extracted as text`);

  const st = statSync(videoPath);
  const key = createHash("sha1").update(`${videoPath}\0${st.size}\0${st.mtimeMs}\0${track.index}`).digest("hex").slice(0, 16);
  const out = join(cacheDir, `${key}${codec.ext}`);
  if (existsSync(out)) return out;

  mkdirSync(cacheDir, { recursive: true });
  const partial = `${out}.partial${codec.ext}`;
  await run(FFMPEG, [
    "-v", "error", "-y",
    "-i", videoPath,
    "-map", `0:${track.index}`,
    "-c:s", codec.copy ? "copy" : "srt",
    partial,
  ]);
  renameSync(partial, out);
  return out;
}
