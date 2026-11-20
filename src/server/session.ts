import { existsSync, unlinkSync } from "node:fs";
import { nowMs } from "../shared/clock.ts";
import { loadOrCreateToken } from "./config.ts";
import { extractTrack, isTextTrack, listSubtitleTracks } from "./embedded/index.ts";
import { ensureLocalCert } from "./https.ts";
import { ipcPath, MpvClient } from "./mpv.ts";
import { lanAddress, localHostName } from "./network.ts";
import type { SubtitleSource } from "./pick-subtitle.ts";
import { startServer } from "./server.ts";
import { LatencyStats } from "./stats.ts";
import { discoverSubtitles, type Tuner } from "./subtitles/index.ts";
import { SyncEngine } from "./sync.ts";

export interface SubtitleSources {
  sources: SubtitleSource[];
  /** Image-based embedded tracks (PGS, VobSub) that can't be mirrored. */
  skippedImage: string[];
  /** Why embedded tracks couldn't be read, if they couldn't. */
  probeError?: string;
}

/** Embedded text tracks first, then matching subtitle files next to the video. */
export async function listSubtitleSources(video: string): Promise<SubtitleSources> {
  let probeError: string | undefined;
  const tracks = await listSubtitleTracks(video).catch((e: Error) => {
    probeError = e.message;
    return [];
  });
  return {
    sources: [
      ...tracks.filter(isTextTrack).map((track) => ({ kind: "embedded" as const, track })),
      ...discoverSubtitles(video).map((path) => ({ kind: "file" as const, path })),
    ],
    skippedImage: tracks.filter((t) => !isTextTrack(t)).map((t) => t.codec),
    probeError,
  };
}

/** Path mpv can load: the file itself, or the embedded track extracted (and cached). */
export function resolveSubtitle(video: string, source: SubtitleSource): Promise<string> {
  return source.kind === "file" ? Promise.resolve(source.path) : extractTrack(video, source.track);
}

export interface SessionOptions {
  video: string;
  subFile: string;
  tuner: Tuner;
  mpvBin: string;
  mpvArgs?: string[];
  port: number;
  host: string;
  /** Issue an mkcert certificate for this machine's names. Ignored when `tls` is given. */
  https?: boolean;
  tls?: { cert: string; key: string };
  /** Latency summary interval; 0 = only on stop. */
  statsEveryMs?: number;
  log?: (line: string) => void;
}

export interface Session {
  /** Preferred phone URL (the .local name when available). */
  url: string;
  /** IP-based URL, when it differs from `url`. */
  lanUrl: string | null;
  tls: boolean;
  /** mkcert root CA to install on the phone, when `https` issued a certificate. */
  rootCA?: string;
  stop(): void;
  /** Resolves once stopped, whether by stop() or by mpv exiting. */
  ended: Promise<void>;
}

export async function startSession(opts: SessionOptions): Promise<Session> {
  const log = opts.log ?? console.log;
  const token = loadOrCreateToken();
  const lan = await lanAddress();
  const mdnsName = localHostName();

  let tls = opts.tls;
  let rootCA: string | undefined;
  if (opts.https && !tls) {
    const files = await ensureLocalCert([mdnsName, lan ?? "127.0.0.1"].filter((h): h is string => !!h));
    tls = files;
    rootCA = files.rootCA;
  }

  const sock = ipcPath();
  if (process.platform !== "win32" && existsSync(sock)) unlinkSync(sock);

  const mpvProc = Bun.spawn(
    [
      opts.mpvBin,
      `--input-ipc-server=${sock}`,
      "--sub-auto=no",
      `--sub-file=${opts.subFile}`,
      "--force-window=immediate",
      ...(opts.mpvArgs ?? []),
      "--",
      opts.video,
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "inherit" },
  );

  const mpv = new MpvClient();
  try {
    await mpv.connect(sock);
  } catch (e) {
    mpvProc.kill();
    throw e;
  }

  const stats = new LatencyStats();
  let web: ReturnType<typeof startServer> | undefined;
  let engine: SyncEngine;
  try {
    // Getters run on first connection, after `engine` is initialized.
    web = startServer({
      port: opts.port,
      hostname: opts.host,
      token,
      tls,
      stats,
      getTrack: () => engine.track,
      getState: () => engine.state,
    });
    const server = web;
    engine = new SyncEngine(mpv, {
      onState(state, discontinuity) {
        if (discontinuity) stats.discontinuity(state.serverTs);
        server.broadcast({ type: "state", state });
      },
      onTrack(track) {
        log(track.error ? `subtitles: ${track.error}` : `subtitles: ${track.cues.length} cues (${track.format}, ${opts.tuner.id} tuner) from ${track.path ?? "—"}`);
        server.broadcast({ type: "track", track });
      },
      onSubText(text, ts) {
        stats.truth(text, ts);
      },
    }, { tuner: opts.tuner });
    await engine.start();
  } catch (e) {
    void web?.server.stop(true);
    mpv.close();
    mpvProc.kill();
    throw e;
  }
  const server = web;

  const statsTimer = setInterval(() => stats.flush(nowMs()), 2000);
  const statsEvery = opts.statsEveryMs ?? 0;
  const printTimer = statsEvery > 0 ? setInterval(() => (stats.steady.length || stats.transition.length) && log(stats.format()), statsEvery) : null;

  let resolveEnded!: () => void;
  const ended = new Promise<void>((r) => (resolveEnded = r));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    engine.stop();
    clearInterval(statsTimer);
    if (printTimer) clearInterval(printTimer);
    stats.flush(nowMs() + 10_000);
    log(stats.format());
    server.broadcast({ type: "ended" });
    mpv.close();
    mpvProc.kill();
    // Let "ended" flush, then force-close sockets: a graceful stop() waits on phones that are asleep.
    setTimeout(() => {
      void server.server.stop(true);
      resolveEnded();
    }, 100);
  };
  mpv.on("close", stop);
  void mpvProc.exited.then(stop);

  const urlFor = (host: string) => `${tls ? "https" : "http"}://${host}:${server.server.port}/?t=${token}`;
  const url = urlFor(mdnsName ?? lan ?? "localhost");
  return { url, lanUrl: mdnsName && lan ? urlFor(lan) : null, tls: !!tls, rootCA, stop, ended };
}
