import { dirname, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { EmbeddedTrack } from "./embedded/index.ts";

export type SubtitleSource = { kind: "file"; path: string } | { kind: "embedded"; track: EmbeddedTrack };

export function describeSource(s: SubtitleSource, videoPath: string): string {
  if (s.kind === "file") return relative(dirname(videoPath), s.path);
  const t = s.track;
  const meta = [t.lang, t.codec, t.default && "default", t.forced && "forced"].filter(Boolean).join(", ");
  return `[embedded #${t.index}] ${t.title ?? "untitled"} (${meta})`;
}

/** Lists the options and asks for a number. Returns the chosen index, or null on "q"/EOF. */
export async function promptForChoice(
  labels: string[],
  io: { input: Readable; output: Writable },
): Promise<number | null> {
  const width = String(labels.length).length;
  io.output.write(`Found ${labels.length} subtitle tracks:\n`);
  labels.forEach((l, i) => io.output.write(`  ${String(i + 1).padStart(width)}) ${l}\n`));

  const ask = `Choose 1-${labels.length} (q to quit): `;
  const rl = createInterface({ input: io.input, terminal: false });
  try {
    io.output.write(ask);
    for await (const line of rl) {
      const answer = line.trim().toLowerCase();
      if (answer === "q") return null;
      const n = Number(answer);
      if (answer && Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
      io.output.write(ask);
    }
    return null;
  } finally {
    rl.close();
  }
}
