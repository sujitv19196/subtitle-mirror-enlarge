import { resolve } from "node:path";
import { nowMs } from "../shared/clock.ts";
import type { PlaybackState, Track } from "../shared/protocol.ts";
import type { MpvClient } from "./mpv.ts";
import { DEFAULT_TUNER, loadSubtitles, type Tuner } from "./subtitles/index.ts";

export interface SyncCallbacks {
  onState(state: PlaybackState, discontinuity: boolean): void;
  onTrack(track: Track): void;
  /** mpv's visible subtitle text; ground truth for latency stats. */
  onSubText(text: string, ts: number): void;
}

interface SubTrackInfo {
  id?: number;
  external?: boolean;
  "external-filename"?: string;
  title?: string;
  lang?: string;
}

export interface SyncOptions {
  /** Resolves relative subtitle paths reported by mpv. */
  cwd?: string;
  driftIntervalMs?: number;
  tuner?: Tuner;
}

/** Turns mpv properties/events into PlaybackState snapshots and Track loads. */
export class SyncEngine {
  private pause = true;
  private pausedForCache = false;
  private seeking = false;
  private speed = 1;
  private subDelay = 0;
  private seq = 0;
  private generation = 0;
  private trackKey: string | null = null;
  private refreshing = false;
  private dirty = false;
  private dirtyDiscontinuity = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  state: PlaybackState | null = null;
  track: Track = { generation: 0, path: null, format: null, cues: [], error: "Waiting for mpv…" };

  private readonly cwd: string;
  private readonly driftIntervalMs: number;
  private readonly tuner: Tuner;

  constructor(
    private readonly mpv: MpvClient,
    private readonly cb: SyncCallbacks,
    opts: SyncOptions = {},
  ) {
    this.cwd = opts.cwd ?? process.cwd();
    this.driftIntervalMs = opts.driftIntervalMs ?? 1000;
    this.tuner = opts.tuner ?? DEFAULT_TUNER;
  }

  async start(): Promise<void> {
    const disc = () => this.refresh(true);
    await this.mpv.observe("pause", (v) => ((this.pause = v !== false), disc()));
    await this.mpv.observe("paused-for-cache", (v) => ((this.pausedForCache = v === true), disc()));
    await this.mpv.observe("speed", (v) => ((this.speed = typeof v === "number" ? v : 1), disc()));
    await this.mpv.observe("sub-delay", (v) => ((this.subDelay = typeof v === "number" ? v : 0), disc()));
    await this.mpv.observe("current-tracks/sub", (v) => void this.onSubTrack(v as SubTrackInfo | null | undefined));
    await this.mpv.observe("sub-text", (v) => this.cb.onSubText(typeof v === "string" ? v : "", nowMs()));

    this.mpv.on("event", (name) => {
      if (name === "seek") {
        this.seeking = true;
        this.refresh(true);
      } else if (name === "playback-restart") {
        this.seeking = false;
        this.refresh(true);
      } else if (name === "file-loaded") {
        this.refresh(true);
      }
    });

    this.timer = setInterval(() => this.refresh(false), this.driftIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** At most one sample in flight; changes during it trigger one more. */
  refresh(discontinuity: boolean): void {
    if (this.refreshing) {
      this.dirty = true;
      this.dirtyDiscontinuity ||= discontinuity;
      return;
    }
    this.refreshing = true;
    void this.sample(discontinuity).finally(() => {
      this.refreshing = false;
      if (this.dirty) {
        const d = this.dirtyDiscontinuity;
        this.dirty = this.dirtyDiscontinuity = false;
        this.refresh(d);
      }
    });
  }

  /** serverTs brackets the IPC round trip, which is sub-millisecond. */
  private async sample(discontinuity: boolean): Promise<void> {
    let mediaTime: number;
    const t0 = nowMs();
    try {
      mediaTime = (await this.mpv.getProperty<number>("playback-time")) ?? 0;
    } catch {
      return; // no file loaded yet
    }
    const t1 = nowMs();
    this.state = {
      seq: ++this.seq,
      mediaTime,
      serverTs: (t0 + t1) / 2,
      rate: this.speed,
      frozen: this.pause || this.seeking || this.pausedForCache,
      subDelay: this.subDelay,
    };
    this.cb.onState(this.state, discontinuity);
  }

  private async onSubTrack(info: SubTrackInfo | null | undefined): Promise<void> {
    const key = info ? `${info.id}:${info["external-filename"] ?? ""}` : "none";
    if (key === this.trackKey) return;
    this.trackKey = key;

    const gen = ++this.generation;
    let track: Track;
    if (!info) {
      track = { generation: gen, path: null, format: null, cues: [], error: "No subtitle track selected in mpv." };
    } else if (!info.external || !info["external-filename"]) {
      track = {
        generation: gen,
        path: null,
        format: null,
        cues: [],
        error: `Track ${info.id}${info.title ? ` (${info.title})` : ""} is embedded in the video. Only external .srt/.ass/.vtt files are supported — pass --sub <file> or put one next to the video.`,
      };
    } else {
      const path = resolve(this.cwd, info["external-filename"]);
      try {
        const { format, cues } = await loadSubtitles(path, this.tuner);
        track = { generation: gen, path, format, cues };
      } catch (e) {
        track = { generation: gen, path, format: null, cues: [], error: (e as Error).message };
      }
    }
    if (gen !== this.generation) return; // superseded while loading
    this.track = track;
    this.cb.onTrack(track);
  }
}
