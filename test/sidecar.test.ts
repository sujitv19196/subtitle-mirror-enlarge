import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SidecarMsg, UiMsg } from "../src/app/protocol.ts";

const dir = mkdtempSync(join(tmpdir(), "submirror-sidecar-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Spawns the sidecar and reads its replies one message at a time. */
function spawnSidecar() {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../src/app/sidecar.ts")], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  const next = async (): Promise<SidecarMsg> => {
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        return JSON.parse(line);
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("sidecar closed stdout");
      buf += value;
    }
  };
  const send = (msg: UiMsg) => {
    proc.stdin.write(JSON.stringify(msg) + "\n");
    proc.stdin.flush();
  };
  return { proc, next, send };
}

test("probe lists subtitle files next to the video", async () => {
  const video = join(dir, "Show S01E01.mkv");
  writeFileSync(video, "not really a video");
  writeFileSync(join(dir, "Show S01E01.en.srt"), "1\n00:00:01,000 --> 00:00:02,000\nhi\n");

  const sc = spawnSidecar();
  expect(await sc.next()).toEqual({ type: "ready" });
  sc.send({ type: "probe", video });

  let msg = await sc.next();
  while (msg.type === "log") msg = await sc.next();
  expect(msg).toEqual({ type: "sources", video, sources: [{ id: 0, label: "Show S01E01.en.srt" }], skippedImage: [] });

  sc.send({ type: "start", video: join(dir, "other.mkv"), sourceId: 0, tuner: "generic" });
  expect(await sc.next()).toMatchObject({ type: "error", message: expect.stringContaining("open the video again") });

  sc.proc.stdin.end();
  expect(await sc.proc.exited).toBe(0);
});

test("useSub accepts a parseable file and rejects one that isn't", async () => {
  const video = join(dir, "No Subs.mkv");
  writeFileSync(video, "not really a video");
  const good = join(dir, "elsewhere.srt");
  writeFileSync(good, "1\n00:00:01,000 --> 00:00:02,000\nhi\n");
  const bad = join(dir, "notes.txt");
  writeFileSync(bad, "just some text");

  const sc = spawnSidecar();
  expect(await sc.next()).toEqual({ type: "ready" });

  sc.send({ type: "useSub", video, path: bad });
  expect(await sc.next()).toMatchObject({ type: "error", message: expect.stringContaining("Unrecognized subtitle format") });

  sc.send({ type: "useSub", video, path: join(dir, "missing.srt") });
  expect(await sc.next()).toMatchObject({ type: "error", message: expect.stringContaining("not found") });

  sc.send({ type: "useSub", video, path: good });
  expect(await sc.next()).toEqual({ type: "sources", video, sources: [{ id: 0, label: "elsewhere.srt" }], skippedImage: [] });

  sc.proc.stdin.end();
  expect(await sc.proc.exited).toBe(0);
});
