import { describe, expect, test } from "bun:test";
import { parseAss } from "../../src/server/subtitles/parsers/ass.ts";
import { parseSubtitles } from "../../src/server/subtitles/index.ts";
import { cuePlainText } from "../../src/shared/protocol.ts";
import { enc, FANSUB_ASS } from "./fixtures.ts";

const parse = (name: string, s: string) => parseSubtitles(name, enc(s));

describe("srt", () => {
  test("basic, CRLF, BOM, italics, entities, {\\an8}", () => {
    const src =
      "﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> &amp; world\r\n\r\n" +
      "2\r\n00:00:03,000 --> 00:00:04,000\r\n{\\an8}Top line\r\nsecond <b>line</b>\r\n";
    const { format, cues } = parse("ep1.srt", src);
    expect(format).toBe("srt");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ id: 0, start: 1, end: 2.5, kind: "dialogue" });
    expect(cues[0]!.lines).toEqual([[{ t: "Hello", i: true }, { t: " & world" }]]);
    expect(cuePlainText(cues[1]!)).toBe("Top line\nsecond line");
  });

  test("UTF-16LE with BOM", () => {
    const s = "1\n00:00:01,000 --> 00:00:02,000\n안녕하세요\n";
    const u16 = new Uint8Array(2 + s.length * 2);
    u16[0] = 0xff;
    u16[1] = 0xfe;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      u16[2 + i * 2] = c & 0xff;
      u16[3 + i * 2] = c >> 8;
    }
    const { cues } = parseSubtitles("k.srt", u16);
    expect(cuePlainText(cues[0]!)).toBe("안녕하세요");
  });

  test("skips malformed blocks", () => {
    const { cues } = parse("x.srt", "garbage\n\n1\n00:00:01,000 --> 00:00:02,000\nok\n");
    expect(cues).toHaveLength(1);
  });
});

describe("vtt", () => {
  test("header, NOTE, short timestamps, voice tags, settings", () => {
    const src =
      "WEBVTT\n\nNOTE hello\n\n" +
      "00:01.000 --> 00:02.000 align:start\n<v Mina>Hi there</v>\n\n" +
      "intro\n01:00:00.500 --> 01:00:01.000\n<i>Later</i>\n";
    const { format, cues } = parse("x.vtt", src);
    expect(format).toBe("vtt");
    expect(cues.map((c) => [c.start, cuePlainText(c)])).toEqual([
      [1, "Hi there"],
      [3600.5, "Later"],
    ]);
  });
});

describe("ass parser", () => {
  const events = parseAss(FANSUB_ASS);
  const at = (start: number) => events.filter((e) => e.start === start);

  test("skips Comment events; keeps every Dialogue event", () => {
    expect(events).toHaveLength(10);
    expect(events.some((e) => e.rawText.includes("not shown"))).toBe(false);
  });

  test("fields: commas in text, style, actor, layer, effect", () => {
    const [a, b] = at(1);
    expect(a).toMatchObject({ style: "Default", actor: "Taro", layer: 0, effect: undefined });
    expect(b!.layer).toBe(1);
    expect(a!.lines).toEqual([[{ t: "Hello, world!" }], [{ t: "Second " }, { t: "line", i: true }, { t: " here" }]]);
  });

  test("style italic, \\i0 override, \\iclip ignored", () => {
    expect(at(4)[0]!.lines).toEqual([[{ t: "I wonder", i: true }, { t: "... no" }]]);
  });

  test("tag facts: positioned, karaoke, drawing", () => {
    expect(at(6)[0]).toMatchObject({ positioned: true, karaoke: false, drawing: false });
    expect(at(7)[0]).toMatchObject({ drawing: true, lines: [] });
    expect(at(9).find((e) => !e.effect)).toMatchObject({ karaoke: true, positioned: false });
    expect(at(9).find((e) => e.effect)!.effect).toBe("fx");
  });

  test("\\h → nbsp; \\an8 alone is not positioned", () => {
    const e = at(13)[0]!;
    expect(e.positioned).toBe(false);
    expect(cuePlainText(e)).toBe("Overlapping speaker nbsp");
  });
});

describe("pipeline with generic tuner", () => {
  const { format, cues } = parse("[Group] Show - 01.ass", FANSUB_ASS);

  test("everything with text is dialogue; layer duplicates merged; drawings dropped", () => {
    expect(format).toBe("ass");
    expect(cues.every((c) => c.kind === "dialogue")).toBe(true);
    expect(cues.filter((c) => c.start === 1)).toHaveLength(1);
    expect(cues.some((c) => c.start === 7)).toBe(false);
  });

  test("ids sequential, sorted by start", () => {
    expect(cues.map((c) => c.id)).toEqual(cues.map((_, i) => i));
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.start);
  });
});

test("format sniffing without extension", () => {
  expect(parse("subs", "WEBVTT\n\n00:01.000 --> 00:02.000\nx\n").format).toBe("vtt");
  expect(parse("subs", "1\n00:00:01,000 --> 00:00:02,000\nx\n").format).toBe("srt");
  expect(() => parse("subs", "hello")).toThrow();
});
