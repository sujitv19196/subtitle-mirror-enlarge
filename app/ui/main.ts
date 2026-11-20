import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resolveResource } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Command, type Child } from "@tauri-apps/plugin-shell";
import type { SidecarMsg, SourceInfo, UiMsg } from "../../src/app/protocol.ts";

const VIDEO_EXTS = ["mkv", "mp4", "m4v", "mov", "avi", "webm", "wmv", "flv", "ts", "m2ts", "mpg", "mpeg", "ogv"];
const SUBTITLE_EXTS = ["srt", "ass", "ssa", "vtt"];
const IS_WINDOWS = navigator.userAgent.includes("Windows");

type Screen = "drop" | "pick" | "starting" | "running";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = document.querySelectorAll<HTMLElement>("[data-screen]");

let screen: Screen = "drop";
let video: string | null = null;
let sources: SourceInfo[] = [];

function show(next: Screen): void {
  screen = next;
  for (const s of screens) s.hidden = s.dataset.screen !== next;
}

function banner(id: "error" | "notice", text: string | null): void {
  const el = $(id);
  el.textContent = text ?? "";
  el.hidden = !text;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const ext = (path: string) => (fileName(path).split(".").pop() ?? "").toLowerCase();

let child: Child | null = null;
let endedWaiters: (() => void)[] = [];

/** Bundled binaries, passed to the sidecar so it never depends on PATH. */
async function binaryEnv(): Promise<Record<string, string>> {
  const res = (name: string) => resolveResource(`resources/${name}`);
  return IS_WINDOWS
    ? { SUBMIRROR_MPV: await res("mpv.exe"), SUBMIRROR_FFMPEG: await res("ffmpeg.exe"), SUBMIRROR_FFPROBE: await res("ffprobe.exe") }
    : { SUBMIRROR_MPV: await res("mpv.app/Contents/MacOS/mpv"), SUBMIRROR_FFMPEG: await res("ffmpeg"), SUBMIRROR_FFPROBE: await res("ffprobe") };
}

async function sidecar(): Promise<Child> {
  if (child) return child;
  const cmd = Command.sidecar("binaries/submirror-sidecar", [], { env: await binaryEnv() });
  cmd.stdout.on("data", (line: string) => {
    if (!line.trim()) return;
    try {
      onMessage(JSON.parse(line) as SidecarMsg);
    } catch {
      console.warn("sidecar:", line);
    }
  });
  cmd.stderr.on("data", (line: string) => console.warn("sidecar:", line));
  cmd.on("close", () => {
    child = null;
    if (screen === "starting" || screen === "running") {
      banner("error", "Subtitle Mirror stopped unexpectedly. Try again.");
      show("drop");
    }
    flushEnded();
  });
  child = await cmd.spawn();
  return child;
}

async function send(msg: UiMsg): Promise<void> {
  await (await sidecar()).write(JSON.stringify(msg) + "\n");
}

function flushEnded(): void {
  for (const w of endedWaiters) w();
  endedWaiters = [];
}

function onMessage(msg: SidecarMsg): void {
  switch (msg.type) {
    case "ready":
      return;
    case "sources":
      if (msg.video !== video) return;
      if (msg.sources.length === 0) {
        banner("error", `No subtitles found in “${fileName(msg.video)}” or next to it. Put an .srt or .ass file with the same name in the same folder.`);
        return show("drop");
      }
      sources = msg.sources;
      return showPick(msg.skippedImage);
    case "progress":
      $("progress").textContent = msg.text;
      return;
    case "started":
      $("qr").innerHTML = msg.qrSvg;
      $("url").textContent = msg.url;
      $("lan-url").textContent = msg.lanUrl ?? "";
      $("lan-wrap").hidden = !msg.lanUrl;
      return show("running");
    case "ended":
      flushEnded();
      if (screen === "running") {
        banner("notice", "Playback ended.");
        show("drop");
      }
      return;
    case "log":
      console.info(msg.text);
      return;
    case "error":
      banner("error", msg.message);
      if (screen === "starting") show("pick");
      return;
  }
}

async function chooseVideo(path: string): Promise<void> {
  if (screen !== "drop") return;
  banner("error", null);
  banner("notice", null);
  if (SUBTITLE_EXTS.includes(ext(path))) {
    banner("error", "That's a subtitle file. Drop the video instead; its subtitles are found automatically.");
    return;
  }
  video = path;
  $("progress").textContent = "Looking for subtitles…";
  show("starting");
  await send({ type: "probe", video: path });
}

function showPick(skippedImage: string[]): void {
  $("video-name").textContent = fileName(video!);
  const list = $("track-list");
  list.replaceChildren(
    ...sources.map((s, i) => {
      const label = document.createElement("label");
      label.className = "track";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "track";
      input.value = String(s.id);
      input.checked = i === 0;
      const text = document.createElement("span");
      text.textContent = s.label;
      label.append(input, text);
      return label;
    }),
  );
  $("tracks").hidden = sources.length < 2;
  const skipped = $("skipped");
  skipped.hidden = skippedImage.length === 0;
  skipped.textContent = `${skippedImage.length} picture-based subtitle track(s) can't be shown on the phone and were left out.`;
  show("pick");
}

async function play(): Promise<void> {
  const checked = document.querySelector<HTMLInputElement>('input[name="track"]:checked');
  const sourceId = checked ? Number(checked.value) : sources[0]!.id;
  banner("error", null);
  $("progress").textContent = "Starting…";
  show("starting");
  await send({ type: "start", video: video!, sourceId, tuner: $<HTMLInputElement>("anime").checked ? "anime" : "generic" });
}

async function stop(): Promise<void> {
  const ended = new Promise<void>((r) => endedWaiters.push(r));
  await send({ type: "stop" });
  await Promise.race([ended, new Promise((r) => setTimeout(r, 2000))]);
}

/** Stop mpv before the app exits; the sidecar is hard-killed on exit. */
let quitting = false;
async function quit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  if (child && screen === "running") await stop().catch(() => {});
  await invoke("quit_ready");
}

$("choose").addEventListener("click", async () => {
  const path = await open({ multiple: false, directory: false, filters: [{ name: "Video", extensions: VIDEO_EXTS }] });
  if (typeof path === "string") await chooseVideo(path);
});
$("back").addEventListener("click", () => show("drop"));
$("play").addEventListener("click", () => void play());
$("stop").addEventListener("click", async () => {
  await stop();
  show("drop");
});

const dropzone = $("dropzone");
await getCurrentWebview().onDragDropEvent((e) => {
  const p = e.payload;
  if (p.type === "enter" || p.type === "over") dropzone.classList.toggle("over", screen === "drop");
  else if (p.type === "leave") dropzone.classList.remove("over");
  else if (p.type === "drop") {
    dropzone.classList.remove("over");
    const first = p.paths.find((path) => VIDEO_EXTS.includes(ext(path))) ?? p.paths[0];
    if (first) void chooseVideo(first);
  }
});

await getCurrentWindow().onCloseRequested(async (e) => {
  e.preventDefault();
  await quit();
});
await listen("quit-requested", () => void quit());

void sidecar().catch((e: unknown) => banner("error", `Couldn't start: ${e}`));
