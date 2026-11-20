import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import ffmpegStatic from "ffmpeg-static";
import { basename } from "node:path";

export const FFMPEG: string = (ffmpegStatic as unknown as string | null) ?? "ffmpeg";
export const FFPROBE: string = ffprobeInstaller.path ?? "ffprobe";

/** Runs a binary, returning stdout; throws with stderr on non-zero exit. */
export async function run(bin: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${basename(bin)} exited ${code}: ${err.trim()}`);
  return out;
}
