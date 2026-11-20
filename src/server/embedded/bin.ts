import { existsSync } from "node:fs";
import { basename } from "node:path";

/** Env override (the desktop app's bundled copy), else the npm binary, else PATH. */
function resolveBin(envVar: string, fromNpm: () => string | null | undefined, fallback: string): string {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  try {
    const p = fromNpm();
    if (p && existsSync(p)) return p;
  } catch {
    // Compiled binaries can't load the npm packages' binaries; @ffprobe-installer throws when its file is missing.
  }
  return fallback;
}

export const FFMPEG = resolveBin("SUBMIRROR_FFMPEG", () => require("ffmpeg-static") as string | null, "ffmpeg");
export const FFPROBE = resolveBin("SUBMIRROR_FFPROBE", () => require("@ffprobe-installer/ffprobe").path as string, "ffprobe");

/** Runs a binary, returning stdout; throws with stderr on non-zero exit. */
export async function run(bin: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${basename(bin)} exited ${code}: ${err.trim()}`);
  return out;
}
