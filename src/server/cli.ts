#!/usr/bin/env bun
import { existsSync, unlinkSync } from "node:fs";
import { parseArgs } from "node:util";
import QRCode from "qrcode";
import { nowMs } from "../shared/clock.ts";
import { ipcPath, MpvClient } from "./mpv.ts";
import { installHint } from "./install-hint.ts";
import { lanAddress, localHostName } from "./network.ts";
import { startServer } from "./server.ts";
import { loadOrCreateToken } from "./config.ts";
import { ensureLocalCert, IPHONE_CA_STEPS } from "./https.ts";
import { extractTrack, isTextTrack, listSubtitleTracks } from "./embedded/index.ts";
import { describeSource, promptForChoice, type SubtitleSource } from "./pick-subtitle.ts";
import { LatencyStats } from "./stats.ts";
import { discoverSubtitles, getTuner, TUNERS } from "./subtitles/index.ts";
import { SyncEngine } from "./sync.ts";

const USAGE = `usage: submirror <video> [options] [-- <extra mpv args>]

  --sub <file>     use this subtitle file instead of searching the video and its folder
  --tuner <id>     content tuner (default generic):
${TUNERS.map((t) => `                     ${t.id.padEnd(9)} ${t.description}`).join("\n")}
  --port <n>       HTTP port (default 8787)
  --host <addr>    bind address (default 0.0.0.0)
  --https          serve HTTPS with an mkcert certificate (lets the phone keep its screen on)
  --cert <pem>     custom TLS cert (instead of --https)
  --key <pem>      custom TLS key
  --mpv <path>     mpv binary (default: mpv on PATH)
  --stats-every <s>  print latency stats every s seconds (default 30, 0 = off)
`;

const dashdash = process.argv.indexOf("--");
const ownArgs = dashdash >= 0 ? process.argv.slice(2, dashdash) : process.argv.slice(2);
const mpvExtra = dashdash >= 0 ? process.argv.slice(dashdash + 1) : [];

const { values, positionals } = parseArgs({
  args: ownArgs,
  allowPositionals: true,
  options: {
    sub: { type: "string" },
    tuner: { type: "string", default: "generic" },
    port: { type: "string", default: "8787" },
    host: { type: "string", default: "0.0.0.0" },
    https: { type: "boolean" },
    cert: { type: "string" },
    key: { type: "string" },
    mpv: { type: "string", default: "mpv" },
    "stats-every": { type: "string", default: "30" },
    help: { type: "boolean", short: "h" },
  },
});

const video = positionals[0];
if (values.help || !video) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
if (!existsSync(video)) fail(`video not found: ${video}`);
if (values.sub && !existsSync(values.sub)) fail(`subtitle file not found: ${values.sub}`);
if (!!values.cert !== !!values.key) fail("--cert and --key must be given together");
const tuner = (() => {
  try {
    return getTuner(values.tuner!);
  } catch (e) {
    return fail((e as Error).message);
  }
})();
const subFile = values.sub ?? (await pickSubtitle(video));
const mpvBin = Bun.which(values.mpv!) ?? fail(`mpv not found ("${values.mpv}"). Install it: ${installHint("mpv")}`);

const token = loadOrCreateToken();
const lan = await lanAddress();
const mdnsName = localHostName();
let tls: { cert: string; key: string } | undefined = values.cert ? { cert: values.cert, key: values.key! } : undefined;
let rootCA: string | undefined;
if (values.https && !tls) {
  const files = await ensureLocalCert([mdnsName, lan ?? "127.0.0.1"].filter((h): h is string => !!h)).catch((e: Error) => fail(e.message));
  tls = files;
  rootCA = files.rootCA;
}

const sock = ipcPath();
if (process.platform !== "win32" && existsSync(sock)) unlinkSync(sock);

const mpvProc = Bun.spawn(
  [
    mpvBin,
    `--input-ipc-server=${sock}`,
    "--sub-auto=no",
    `--sub-file=${subFile}`,
    "--force-window=immediate",
    ...mpvExtra,
    "--",
    video,
  ],
  { stdin: "ignore", stdout: "ignore", stderr: "inherit" },
);

const mpv = new MpvClient();
await mpv.connect(sock).catch((e) => fail(e.message));

const stats = new LatencyStats();

// Getters run on first connection, after `engine` is initialized.
const web = startServer({
  port: Number(values.port),
  hostname: values.host!,
  token,
  tls,
  stats,
  getTrack: () => engine.track,
  getState: () => engine.state,
});
const engine = new SyncEngine(mpv, {
  onState(state, discontinuity) {
    if (discontinuity) stats.discontinuity(state.serverTs);
    web.broadcast({ type: "state", state });
  },
  onTrack(track) {
    const where = track.path ?? "—";
    console.log(track.error ? `subtitles: ${track.error}` : `subtitles: ${track.cues.length} cues (${track.format}, ${tuner.id} tuner) from ${where}`);
    web.broadcast({ type: "track", track });
  },
  onSubText(text, ts) {
    stats.truth(text, ts);
  },
}, { tuner });

await engine.start();

const urlFor = (host: string) => `${tls ? "https" : "http"}://${host}:${web.server.port}/?t=${token}`;
const url = urlFor(mdnsName ?? lan ?? "localhost");
console.log("\n" + (await QRCode.toString(url, { type: "terminal", errorCorrectionLevel: "L" })));
console.log(`Open on your phone: ${url}`);
if (mdnsName && lan) console.log(`If that doesn't load (some networks block .local names): ${urlFor(lan)}`);
if (rootCA) console.log("\n" + IPHONE_CA_STEPS(rootCA));
if (!tls) console.log("(HTTP: screen wake lock unavailable; using the video fallback. Run with --https for the real thing.)");
console.log("iPhone full screen: Share → Add to Home Screen, then launch from the icon.");

const statsEvery = Number(values["stats-every"]) * 1000;
const statsTimer = setInterval(() => stats.flush(nowMs()), 2000);
const printTimer = statsEvery > 0 ? setInterval(() => (stats.steady.length || stats.transition.length) && console.log(stats.format()), statsEvery) : null;

let shuttingDown = false;
function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  engine.stop();
  clearInterval(statsTimer);
  if (printTimer) clearInterval(printTimer);
  stats.flush(nowMs() + 10_000);
  console.log("\n" + stats.format());
  web.broadcast({ type: "ended" });
  mpv.close();
  mpvProc.kill();
  // Let "ended" flush, then force-close sockets: a graceful stop() waits on phones that are asleep.
  setTimeout(() => {
    void web.server.stop(true);
    process.exit(code);
  }, 100);
}

mpv.on("close", () => shutdown(0));
void mpvProc.exited.then(() => shutdown(0));
/** A second Ctrl+C exits immediately. */
const onSignal = (code: number) => () => (shuttingDown ? process.exit(code) : shutdown(code));
process.on("SIGINT", onSignal(130));
process.on("SIGTERM", onSignal(143));

async function pickSubtitle(videoPath: string): Promise<string> {
  const tracks = await listSubtitleTracks(videoPath).catch((e: Error) => {
    console.warn(`could not read embedded tracks: ${e.message}`);
    return [];
  });
  const imageTracks = tracks.filter((t) => !isTextTrack(t));
  if (imageTracks.length) console.log(`skipping ${imageTracks.length} image-based embedded track(s) (${imageTracks.map((t) => t.codec).join(", ")})`);

  const sources: SubtitleSource[] = [
    ...tracks.filter(isTextTrack).map((track) => ({ kind: "embedded" as const, track })),
    ...discoverSubtitles(videoPath).map((path) => ({ kind: "file" as const, path })),
  ];
  if (sources.length === 0) {
    fail(`no text subtitles found in ${videoPath} or next to it (its folder, Subs/, Subs/<video name>/). Pass one with --sub <file>`);
  }

  const labels = sources.map((s) => describeSource(s, videoPath));
  let chosen: SubtitleSource;
  if (sources.length === 1) chosen = sources[0]!;
  else if (!process.stdin.isTTY) fail(`found ${sources.length} subtitle tracks; pass one with --sub <file>:\n  ${labels.join("\n  ")}`);
  else {
    const i = await promptForChoice(labels, { input: process.stdin, output: process.stdout });
    chosen = i === null ? fail("no subtitle chosen") : sources[i]!;
  }
  console.log(`subtitle: ${describeSource(chosen, videoPath)}`);
  if (chosen.kind === "file") return chosen.path;

  console.log("extracting track (reads the whole file; cached after the first run)…");
  return extractTrack(videoPath, chosen.track).catch((e: Error) => fail(e.message));
}

function fail(msg: string): never {
  console.error(`submirror: ${msg}`);
  process.exit(1);
}
