import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ipcPath, MpvClient } from "../src/server/mpv.ts";
import { SyncEngine } from "../src/server/sync.ts";
import type { PlaybackState, Track } from "../src/shared/protocol.ts";

/** Speaks enough of mpv's JSON IPC to drive MpvClient + SyncEngine. */
class FakeMpv {
  props: Record<string, unknown> = {
    pause: false,
    "paused-for-cache": false,
    speed: 1,
    "sub-delay": 0,
    "current-tracks/sub": null,
    "sub-text": "",
    "playback-time": 0,
  };
  observers = new Map<string, number[]>();
  sock: Socket | null = null;
  server: Server;

  constructor(path: string) {
    this.server = createServer((s) => {
      this.sock = s;
      let buf = "";
      s.setEncoding("utf8");
      s.on("data", (d: string) => {
        buf += d;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          this.handle(JSON.parse(line));
        }
      });
    });
    this.server.listen(path);
  }

  private write(o: unknown) {
    this.sock?.write(JSON.stringify(o) + "\n");
  }

  private handle(msg: { command: unknown[]; request_id: number }) {
    const [cmd, a, b] = msg.command as [string, unknown, unknown];
    if (cmd === "observe_property") {
      const name = b as string;
      this.observers.set(name, [...(this.observers.get(name) ?? []), a as number]);
      this.write({ error: "success", request_id: msg.request_id });
      this.write({ event: "property-change", id: a, name, data: this.props[name] });
    } else if (cmd === "get_property") {
      this.write({ error: "success", data: this.props[a as string], request_id: msg.request_id });
    }
  }

  set(name: string, value: unknown) {
    this.props[name] = value;
    for (const id of this.observers.get(name) ?? []) this.write({ event: "property-change", id, name, data: value });
  }

  event(name: string) {
    this.write({ event: name });
  }

  close() {
    this.sock?.destroy();
    this.server.close();
  }
}

const dir = mkdtempSync(join(tmpdir(), "submirror-test-"));
let cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.forEach((f) => f());
  cleanup = [];
});

async function setup() {
  const sockPath = ipcPath(`test-${Math.random().toString(36).slice(2)}`);
  const fake = new FakeMpv(sockPath);
  const client = new MpvClient();
  await client.connect(sockPath, 2000);
  const states: { state: PlaybackState; disc: boolean }[] = [];
  const tracks: Track[] = [];
  const truths: string[] = [];
  const engine = new SyncEngine(
    client,
    {
      onState: (state, disc) => states.push({ state, disc }),
      onTrack: (t) => tracks.push(t),
      onSubText: (t) => truths.push(t),
    },
    { cwd: dir, driftIntervalMs: 50 },
  );
  await engine.start();
  cleanup.push(() => {
    engine.stop();
    client.close();
    fake.close();
  });
  return { fake, engine, states, tracks, truths };
}

const until = async (cond: () => boolean, ms = 1000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await Bun.sleep(5);
  }
};

test("loads external subtitle track and reports embedded/none tracks as errors", async () => {
  writeFileSync(join(dir, "ep.srt"), "1\n00:00:01,000 --> 00:00:02,000\nhi\n");
  const { fake, tracks } = await setup();
  await until(() => tracks.length >= 1);
  expect(tracks[0]!.error).toContain("No subtitle track");

  fake.set("current-tracks/sub", { id: 1, external: true, "external-filename": "ep.srt" });
  await until(() => tracks.length >= 2);
  expect(tracks[1]).toMatchObject({ generation: 2, format: "srt", path: join(dir, "ep.srt") });
  expect(tracks[1]!.cues).toHaveLength(1);

  fake.set("current-tracks/sub", { id: 2, external: false, title: "English" });
  await until(() => tracks.length >= 3);
  expect(tracks[2]!.error).toContain("embedded");
});

test("pause, seek and speed produce discontinuous states; freeze during seek", async () => {
  const { fake, states } = await setup();
  fake.set("playback-time", 12.5);
  fake.event("file-loaded");
  await until(() => states.some((s) => s.state.mediaTime === 12.5));

  fake.set("pause", true);
  await until(() => states.at(-1)!.state.frozen && states.at(-1)!.disc);

  fake.set("pause", false);
  fake.event("seek");
  fake.set("playback-time", 100);
  await until(() => states.at(-1)!.state.mediaTime === 100);
  expect(states.at(-1)!.state.frozen).toBe(true); // seeking, not yet restarted

  fake.event("playback-restart");
  await until(() => !states.at(-1)!.state.frozen);

  fake.set("speed", 1.25);
  fake.set("sub-delay", -0.5);
  await until(() => states.at(-1)!.state.rate === 1.25 && states.at(-1)!.state.subDelay === -0.5);

  // seq strictly increasing
  const seqs = states.map((s) => s.state.seq);
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
});

test("periodic drift samples are non-discontinuous", async () => {
  const { fake, states } = await setup();
  fake.set("playback-time", 1);
  await until(() => states.filter((s) => !s.disc).length >= 2, 1000);
});

test("sub-text changes are forwarded as ground truth", async () => {
  const { fake, truths } = await setup();
  fake.set("sub-text", "Hello there");
  await until(() => truths.includes("Hello there"));
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
