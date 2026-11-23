#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import QRCode from "qrcode";
import { IPHONE_CA_STEPS } from "./https.ts";
import { installHint } from "./install-hint.ts";
import { describeSource, promptForChoice, type SubtitleSource } from "./pick-subtitle.ts";
import { listSubtitleSources, resolveSubtitle, startSession, userSubtitle } from "./session.ts";
import { getTuner, TUNERS } from "./subtitles/index.ts";

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
if (!!values.cert !== !!values.key) fail("--cert and --key must be given together");
const tuner = (() => {
  try {
    return getTuner(values.tuner!);
  } catch (e) {
    return fail((e as Error).message);
  }
})();
const subFile = values.sub
  ? (await userSubtitle(values.sub).catch((e: Error) => fail(e.message))).path
  : await pickSubtitle(video);
const mpvBin = Bun.which(values.mpv!) ?? fail(`mpv not found ("${values.mpv}"). Install it: ${installHint("mpv")}`);

const session = await startSession({
  video,
  subFile,
  tuner,
  mpvBin,
  mpvArgs: mpvExtra,
  port: Number(values.port),
  host: values.host!,
  https: values.https,
  tls: values.cert ? { cert: values.cert, key: values.key! } : undefined,
  statsEveryMs: Number(values["stats-every"]) * 1000,
}).catch((e: Error) => fail(e.message));

console.log("\n" + (await QRCode.toString(session.url, { type: "terminal", errorCorrectionLevel: "L" })));
console.log(`Open on your phone: ${session.url}`);
if (session.lanUrl) console.log(`If that doesn't load (some networks block .local names): ${session.lanUrl}`);
if (session.rootCA) console.log("\n" + IPHONE_CA_STEPS(session.rootCA));
if (!session.tls) console.log("(HTTP: screen wake lock unavailable; using the video fallback. Run with --https for the real thing.)");
console.log("iPhone full screen: Share → Add to Home Screen, then launch from the icon.");

let exitCode = 0;
void session.ended.then(() => process.exit(exitCode));
/** A second Ctrl+C exits immediately. */
let stopping = false;
const onSignal = (code: number) => () => {
  if (stopping) process.exit(code);
  stopping = true;
  exitCode = code;
  console.log();
  session.stop();
};
process.on("SIGINT", onSignal(130));
process.on("SIGTERM", onSignal(143));

async function pickSubtitle(videoPath: string): Promise<string> {
  const { sources, skippedImage, probeError } = await listSubtitleSources(videoPath);
  if (probeError) console.warn(`could not read embedded tracks: ${probeError}`);
  if (skippedImage.length) console.log(`skipping ${skippedImage.length} image-based embedded track(s) (${skippedImage.join(", ")})`);
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
  if (chosen.kind === "embedded") console.log("extracting track (reads the whole file; cached after the first run)…");
  return resolveSubtitle(videoPath, chosen).catch((e: Error) => fail(e.message));
}

function fail(msg: string): never {
  console.error(`submirror: ${msg}`);
  process.exit(1);
}
