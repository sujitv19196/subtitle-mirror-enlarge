import { expect, test } from "bun:test";
import { LatencyStats } from "../src/server/stats.ts";

test("matches renders to mpv truth, buckets around discontinuities", () => {
  const s = new LatencyStats();
  s.discontinuity(0);
  s.truth("Seek line", 100);
  s.rendered(["Seek line"], 140); // within 1s of discontinuity → transition
  s.truth("First line", 5000);
  s.rendered(["First line"], 5012);
  s.truth("Two\nlines here", 8000);
  s.rendered(["two lines here"], 7995); // normalized; phone slightly early
  s.flush(20_000);
  expect(s.transition).toEqual([40]);
  expect(s.steady.sort()).toEqual([-5, 12]);
});

test("mpv sub-text joins simultaneous lines; a single cue still matches", () => {
  const s = new LatencyStats();
  s.truth("Sign text\nDialogue line", 1000);
  s.rendered(["Dialogue line"], 1020);
  s.flush(10_000);
  expect(s.steady).toEqual([20]);
});

test("unmatched renders expire after the window", () => {
  const s = new LatencyStats();
  s.rendered(["nobody said this"], 0);
  s.flush(10_000);
  expect(s.steady).toEqual([]);
  expect(LatencyStats.summarize([])).toBeNull();
});
