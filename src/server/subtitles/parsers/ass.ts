import type { SubEvent } from "../model.ts";
import { LineBuilder } from "../text.ts";

export function parseAssTime(s: string): number | null {
  const m = /(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/.exec(s.trim());
  if (!m) return null;
  const frac = m[4] ? Number(m[4]) / 10 ** m[4].length : 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

interface Style {
  italic: boolean;
}

const DEFAULT_EVENT_FORMAT = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];

/** Dialogue events only; Comment events aren't rendered. */
export function parseAss(text: string): SubEvent[] {
  const styles = new Map<string, Style>();
  const events: SubEvent[] = [];
  let section = "";
  let styleFormat: string[] = [];
  let eventFormat: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1]!.toLowerCase();
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trimStart();

    if (section.includes("styles")) {
      if (key === "format") styleFormat = value.split(",").map((s) => s.trim().toLowerCase());
      else if (key === "style") {
        const f = splitFields(value, styleFormat.length);
        const get = (n: string) => f[styleFormat.indexOf(n)]?.trim() ?? "";
        styles.set(get("name"), { italic: get("italic") === "-1" || get("italic") === "1" });
      }
    } else if (section === "events") {
      if (key === "format") eventFormat = value.split(",").map((s) => s.trim().toLowerCase());
      else if (key === "dialogue") {
        const fmt = eventFormat.length ? eventFormat : DEFAULT_EVENT_FORMAT;
        const f = splitFields(value, fmt.length);
        const get = (n: string) => f[fmt.indexOf(n)] ?? "";
        const ev = parseEvent(get, styles);
        if (ev) events.push(ev);
      }
    }
  }
  return events;
}

/** Split into n fields; the last field (Text) keeps any commas. */
function splitFields(value: string, n: number): string[] {
  const out: string[] = [];
  let rest = value;
  for (let i = 0; i < n - 1; i++) {
    const c = rest.indexOf(",");
    if (c < 0) break;
    out.push(rest.slice(0, c));
    rest = rest.slice(c + 1);
  }
  out.push(rest);
  return out;
}

function parseEvent(get: (field: string) => string, styles: Map<string, Style>): SubEvent | null {
  const start = parseAssTime(get("start"));
  const end = parseAssTime(get("end"));
  if (start == null || end == null) return null;

  const style = get("style").trim();
  const rawText = get("text");
  const styleItalic = styles.get(style)?.italic ?? false;
  const layer = Number.parseInt(get("layer"), 10);

  let italic = styleItalic;
  let drawingMode = false;
  let drawing = false;
  let positioned = false;
  let karaoke = false;

  const b = new LineBuilder();
  const emit = (t: string) => {
    if (!drawingMode) b.text(t, italic);
  };
  const re = /\{([^}]*)\}|\\N|\\n|\\h/g;
  let pos = 0;
  for (let m; (m = re.exec(rawText)); ) {
    emit(rawText.slice(pos, m.index));
    pos = re.lastIndex;
    const tok = m[0];
    if (tok === "\\N" || tok === "\\n") {
      if (!drawingMode) b.newline();
    } else if (tok === "\\h") emit(" ");
    else {
      for (const t of m[1]!.matchAll(/\\(pos|move|kf|ko|k|K|p|i|r)([^\\]*)/g)) {
        const [, tag, arg = ""] = t;
        switch (tag) {
          case "pos":
          case "move":
            if (arg.trimStart().startsWith("(")) positioned = true;
            break;
          case "k":
          case "K":
          case "kf":
          case "ko":
            if (/^\d/.test(arg)) karaoke = true;
            break;
          case "p": {
            const n = Number.parseInt(arg, 10);
            if (!Number.isNaN(n)) {
              drawingMode = n > 0;
              drawing ||= drawingMode;
            }
            break;
          }
          case "i": {
            // Not \iclip.
            const v = arg.trim();
            if (v === "") italic = styleItalic;
            else if (v === "0" || v === "1") italic = v === "1";
            break;
          }
          case "r": {
            const s = arg.trim();
            italic = (s ? styles.get(s)?.italic : styleItalic) ?? styleItalic;
            break;
          }
        }
      }
    }
  }
  emit(rawText.slice(pos));

  return {
    start,
    end,
    lines: b.build(),
    rawText,
    style,
    actor: get("name").trim() || undefined,
    effect: get("effect").trim() || undefined,
    layer: Number.isNaN(layer) ? undefined : layer,
    positioned,
    karaoke,
    drawing,
  };
}
