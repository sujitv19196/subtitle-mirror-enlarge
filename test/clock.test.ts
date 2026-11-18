import { expect, test } from "bun:test";
import { ClockEstimator } from "../src/shared/clock.ts";
import { activeCues, mediaTimeAt, type Cue, type PlaybackState } from "../src/shared/protocol.ts";

test("clock offset: symmetric paths give exact offset", () => {
  const c = new ClockEstimator();
  // server is 1000ms ahead; 20ms rtt
  c.add(0, 1010, 20);
  expect(c.offset).toBe(1000);
});

test("clock offset: low-RTT samples win over power-save spikes", () => {
  const c = new ClockEstimator();
  const trueOffset = 5000;
  let t = 0;
  const sample = (up: number, down: number) => {
    const t0 = t;
    const ts = t0 + up + trueOffset;
    const t1 = t0 + up + down;
    c.add(t0, ts, t1);
    t += 100;
  };
  for (let i = 0; i < 5; i++) sample(4, 4); // clean
  for (let i = 0; i < 10; i++) sample(250, 10); // asymmetric Wi-Fi wakeup spikes
  expect(Math.abs(c.offset - trueOffset)).toBeLessThan(1);
});

test("mediaTimeAt extrapolates with rate and freezes when frozen", () => {
  const s: PlaybackState = { seq: 1, mediaTime: 10, serverTs: 1000, rate: 1.5, frozen: false, subDelay: 0 };
  expect(mediaTimeAt(s, 3000)).toBe(13);
  expect(mediaTimeAt({ ...s, frozen: true }, 3000)).toBe(10);
});

test("activeCues: boundaries, overlaps, sub-delay", () => {
  const mk = (id: number, start: number, end: number): Cue => ({ id, start, end, kind: "dialogue", lines: [[{ t: String(id) }]] });
  const cues = [mk(0, 0, 100), mk(1, 1, 2), mk(2, 2, 3), mk(3, 2.5, 4)];
  const ids = (t: number, d = 0) => activeCues(cues, t, d).map((c) => c.id);
  expect(ids(0.5)).toEqual([0]);
  expect(ids(1)).toEqual([0, 1]);
  expect(ids(2)).toEqual([0, 2]); // end is exclusive
  expect(ids(2.75)).toEqual([0, 2, 3]);
  expect(ids(3.5, 1)).toEqual([0, 2, 3]); // delay 1s → effective 2.5
  expect(ids(-1)).toEqual([]);
});
