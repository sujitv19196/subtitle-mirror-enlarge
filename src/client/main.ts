import { ClockEstimator, nowMs } from "../shared/clock.ts";
import {
  activeCues,
  mediaTimeAt,
  type ClientMsg,
  type Cue,
  type PlaybackState,
  type ServerMsg,
  type Track,
} from "../shared/protocol.ts";
import { applySettings, bindForm, DEFAULTS, loadSettings, saveSettings, type Settings } from "./settings.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const dialogueEl = $("dialogue");
const signsEl = $("signs");
const statusEl = $("status");
const statusText = $("status-text");
const settingsDialog = $<HTMLDialogElement>("settings");

let settings: Settings = loadSettings();
applySettings(settings);
const resyncForm = bindForm(
  $<HTMLFormElement>("settings-form"),
  () => settings,
  (s) => {
    settings = s;
    applySettings(s);
    saveSettings(s);
    shownKey = "";
  },
);
$("open-settings").addEventListener("click", () => {
  resyncForm();
  settingsDialog.showModal();
  updateDiag();
});
$("reset-settings").addEventListener("click", () => {
  settings = { ...DEFAULTS };
  applySettings(settings);
  saveSettings(settings);
  resyncForm();
});

const token = new URLSearchParams(location.search).get("t") ?? "";
let ws: WebSocket | null = null;
let connected = false;
let ended = false;
let retryMs = 250;
let pingTimer: ReturnType<typeof setInterval> | undefined;
const clock = new ClockEstimator();
let track: Track | null = null;
let state: PlaybackState | null = null;

function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(token)}`);
  ws = sock;
  sock.onopen = () => {
    connected = true;
    retryMs = 250;
    pingBurst();
    clearInterval(pingTimer);
    pingTimer = setInterval(ping, 2000);
    updateStatus();
  };
  sock.onmessage = (e) => handle(JSON.parse(e.data as string) as ServerMsg);
  sock.onclose = () => {
    if (ws !== sock) return;
    connected = false;
    clearInterval(pingTimer);
    updateStatus();
    if (!ended) setTimeout(connect, (retryMs = Math.min(retryMs * 2, 4000)));
  };
}

function send(msg: ClientMsg): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function ping(): void {
  send({ type: "ping", t0: nowMs() });
}

/** Converges the clock offset within ~0.5s. */
function pingBurst(): void {
  for (let i = 0; i < 8; i++) setTimeout(ping, i * 50);
}

function handle(msg: ServerMsg): void {
  switch (msg.type) {
    case "pong":
      clock.add(msg.t0, msg.ts, nowMs());
      break;
    case "track":
      track = msg.track;
      held = null;
      shownKey = "";
      updateStatus();
      break;
    case "state": {
      // A seek invalidates the held line.
      if (state && Math.abs(mediaTimeAt(state, msg.state.serverTs) - msg.state.mediaTime) > 1) held = null;
      state = msg.state;
      updateStatus();
      break;
    }
    case "ended":
      ended = true;
      updateStatus();
      break;
  }
}

let shownKey = "";
let shownIds = new Set<number>();
let held: Cue | null = null;

function frame(): void {
  requestAnimationFrame(frame);
  if (!track || !state) return;
  const t = mediaTimeAt(state, clock.toServer(nowMs()));
  const active = activeCues(track.cues, t, state.subDelay);
  const key = `${track.generation}:${active.map((c) => c.id).join(",")}`;
  if (key === shownKey) return;
  shownKey = key;

  const main = active.filter((c) => c.kind !== "sign");
  const signs = active.filter((c) => c.kind === "sign");
  const lastDialogue = main.filter((c) => c.kind === "dialogue").at(-1);
  if (lastDialogue) held = lastDialogue;

  if (main.length === 0 && settings.holdLast && held) {
    dialogueEl.replaceChildren(cueEl(held, true));
  } else {
    dialogueEl.replaceChildren(...main.map((c) => cueEl(c, false)));
  }
  signsEl.replaceChildren(...signs.map((c) => cueEl(c, false)));

  const fresh = active.filter((c) => !shownIds.has(c.id)).map((c) => c.id);
  shownIds = new Set(active.map((c) => c.id));
  if (fresh.length && clock.sampleCount >= 3) {
    send({ type: "rendered", generation: track.generation, cueIds: fresh, ts: clock.toServer(nowMs()) });
  }
}

function cueEl(c: Cue, dim: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = `cue ${c.kind}${dim ? " held" : ""}`;
  for (const line of c.lines) {
    const ln = document.createElement("div");
    ln.className = "line";
    for (const run of line) {
      const span = document.createElement("span");
      if (run.i) span.className = "it";
      span.textContent = run.t;
      ln.append(span);
    }
    el.append(ln);
  }
  return el;
}

function updateStatus(): void {
  let kind: string;
  let text: string;
  if (ended) [kind, text] = ["idle", "Playback ended"];
  else if (!connected) [kind, text] = ["warn", ws ? "Reconnecting…" : "Connecting…"];
  else if (track?.error) [kind, text] = ["error", track.error];
  else if (!state) [kind, text] = ["idle", "Waiting for playback…"];
  else if (state.frozen) [kind, text] = ["idle", "Paused"];
  else [kind, text] = ["live", "Live"];
  if (statusEl.dataset.kind !== kind || statusText.textContent !== text) {
    statusEl.dataset.kind = kind;
    statusText.textContent = text;
  }
}

function updateDiag(): void {
  if (!settingsDialog.open) return;
  const rows: [string, string][] = [
    ["Connection", connected ? "connected" : "disconnected"],
    ["Clock offset", `${clock.offset.toFixed(1)} ms`],
    ["Best RTT", Number.isFinite(clock.minRtt) ? `${clock.minRtt.toFixed(1)} ms (±${(clock.minRtt / 2).toFixed(1)})` : "—"],
    ["Subtitles", track ? (track.error ?? `${track.cues.length} cues · ${track.format} · ${track.path?.split("/").pop()}`) : "—"],
    ["Speed / delay", state ? `${state.rate}× · ${state.subDelay.toFixed(2)} s` : "—"],
    ["Screen wake lock", wakeLockStatus],
  ];
  $("diag").replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      return [dt, dd];
    }),
  );
  setTimeout(updateDiag, 500);
}

let wakeLock: WakeLockSentinel | null = null;
let wakeLockStatus = "not requested";
const keepAwakeVideo = $<HTMLVideoElement>("keepawake");

/** Wake Lock needs HTTPS; otherwise a looping muted video keeps the screen on. Must run from a tap. */
async function keepAwake(): Promise<void> {
  if (wakeLock && !wakeLock.released) return;
  if ("wakeLock" in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLockStatus = "wake lock active";
      keepAwakeVideo.pause();
      wakeLock.addEventListener("release", () => (wakeLockStatus = "wake lock released"));
      return;
    } catch {}
  }
  try {
    await keepAwakeVideo.play();
    wakeLockStatus = "video fallback active" + (window.isSecureContext ? "" : " (no HTTPS)");
  } catch (e) {
    wakeLockStatus = `inactive — tap the screen (${(e as Error).name})`;
  }
}

function goFullscreen(): void {
  const el = document.documentElement;
  if (document.fullscreenEnabled && !document.fullscreenElement) {
    el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  }
}

// Generated by the server (start_url carries the token), so it can't be a bundled <link>.
document.head.append(Object.assign(document.createElement("link"), { rel: "manifest", href: "/manifest.webmanifest" }));

const isIOS = /iPhone|iPod/.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
$("install-hint").hidden = !(isIOS && !standalone);
$("open-install").hidden = !(isIOS && !standalone);
$("open-install").addEventListener("click", () => $<HTMLDialogElement>("install-guide").showModal());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  void keepAwake();
  if (!connected && !ended) connect();
  else pingBurst();
});
document.addEventListener(
  "pointerdown",
  (e) => {
    void keepAwake();
    if (!(e.target as Element).closest("dialog, .fab")) goFullscreen();
  },
  { passive: true },
);

void keepAwake();
connect();
updateStatus();
requestAnimationFrame(frame);
