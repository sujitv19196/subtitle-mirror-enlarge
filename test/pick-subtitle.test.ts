import { expect, test } from "bun:test";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describeSource, promptForChoice } from "../src/server/pick-subtitle.ts";

async function run(input: string, labels = ["a.ass", "b.srt"]) {
  const inp = new PassThrough();
  const out = new PassThrough();
  let text = "";
  out.on("data", (d) => (text += d));
  inp.end(input);
  return { choice: await promptForChoice(labels, { input: inp, output: out }), text };
}

test("lists labels and returns the chosen index", async () => {
  const { choice, text } = await run("2\n");
  expect(text).toContain("1) a.ass");
  expect(text).toContain("2) b.srt");
  expect(choice).toBe(1);
});

test("re-asks on invalid input, including empty", async () => {
  const { choice, text } = await run("\n9\nfoo\n1\n");
  expect(choice).toBe(0);
  expect(text.match(/Choose/g)).toHaveLength(4);
});

test("q or EOF returns null", async () => {
  expect((await run("q\n")).choice).toBeNull();
  expect((await run("")).choice).toBeNull();
});

test("describeSource", () => {
  expect(describeSource({ kind: "file", path: "/v/Subs/ep.srt" }, "/v/ep.mkv")).toBe(join("Subs", "ep.srt"));
  expect(
    describeSource(
      { kind: "embedded", track: { index: 3, codec: "ass", lang: "eng", title: "Signs & Songs", default: false, forced: true } },
      "/v/ep.mkv",
    ),
  ).toBe("[embedded #3] Signs & Songs (eng, ass, forced)");
});
