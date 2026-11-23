#!/usr/bin/env bun
/** Desktop app backend: drives startSession() over stdio (see protocol.ts). */
import { createInterface } from "node:readline";
import QRCode from "qrcode";
import { describeSource, type SubtitleSource } from "../server/pick-subtitle.ts";
import { listSubtitleSources, resolveSubtitle, startSession, userSubtitle, type Session } from "../server/session.ts";
import { getTuner } from "../server/subtitles/index.ts";
import type { SidecarMsg, UiMsg } from "./protocol.ts";

const PORT = 8787;

const send = (msg: SidecarMsg) => process.stdout.write(JSON.stringify(msg) + "\n");
const log = (text: string) => send({ type: "log", text });

let probed: { video: string; sources: SubtitleSource[] } | null = null;
let session: Session | null = null;
let busy = false;

async function handle(msg: UiMsg): Promise<void> {
  switch (msg.type) {
    case "probe": {
      const { sources, skippedImage, probeError } = await listSubtitleSources(msg.video);
      if (probeError) log(`could not read embedded tracks: ${probeError}`);
      probed = { video: msg.video, sources };
      send({
        type: "sources",
        video: msg.video,
        sources: sources.map((s, id) => ({ id, label: describeSource(s, msg.video) })),
        skippedImage,
      });
      return;
    }
    case "useSub": {
      const source = await userSubtitle(msg.path);
      probed = { video: msg.video, sources: [source] };
      send({ type: "sources", video: msg.video, sources: [{ id: 0, label: describeSource(source, msg.video) }], skippedImage: [] });
      return;
    }
    case "start": {
      if (session || busy) throw new Error("already playing; stop first");
      const source = probed?.video === msg.video ? probed.sources[msg.sourceId] : undefined;
      if (!source) throw new Error("unknown subtitle choice; open the video again");
      const mpvBin = process.env.SUBMIRROR_MPV || Bun.which("mpv");
      if (!mpvBin) throw new Error("mpv was not found");
      busy = true;
      try {
        if (source.kind === "embedded") send({ type: "progress", text: "Extracting subtitles…" });
        const subFile = await resolveSubtitle(msg.video, source);
        send({ type: "progress", text: "Starting the player…" });
        const s = await startSession({
          video: msg.video,
          subFile,
          tuner: getTuner(msg.tuner),
          mpvBin,
          port: PORT,
          host: "0.0.0.0",
          log,
        });
        session = s;
        void s.ended.then(() => {
          if (session === s) session = null;
          send({ type: "ended" });
        });
        const qrSvg = await QRCode.toString(s.url, { type: "svg", errorCorrectionLevel: "L", margin: 1 });
        send({ type: "started", url: s.url, lanUrl: s.lanUrl, qrSvg });
      } finally {
        busy = false;
      }
      return;
    }
    case "stop":
      session?.stop();
      return;
  }
}

/** mpv must not outlive the app: stop when the UI goes away. */
async function shutdown(): Promise<never> {
  const s = session;
  if (s) {
    s.stop();
    await Promise.race([s.ended, Bun.sleep(2000)]);
  }
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg: UiMsg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ type: "error", message: `bad message: ${line}` });
  }
  handle(msg).catch((e: Error) => send({ type: "error", message: friendlyError(e) }));
});
rl.on("close", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
send({ type: "ready" });

function friendlyError(e: Error): string {
  if ((e as NodeJS.ErrnoException).code === "EADDRINUSE" || /EADDRINUSE|address already in use/i.test(e.message)) {
    return `Port ${PORT} is already in use. Is Subtitle Mirror already running?`;
  }
  return e.message;
}
