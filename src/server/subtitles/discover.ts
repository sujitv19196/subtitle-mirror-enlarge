import { readdirSync, type Dirent } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const SUBTITLE_EXTS = new Set([".ass", ".ssa", ".srt", ".vtt", ".webvtt"]);
const VIDEO_EXTS = new Set([".mkv", ".mp4", ".m4v", ".avi", ".mov", ".webm", ".ts", ".m2ts", ".wmv", ".flv"]);
const SUB_DIR = /^(subs?|subtitles?)$/i;

/**
 * Sidecar subtitles for a video, sorted by path. Searches its folder, Subs/ and
 * Subs/<video name>/. A file belongs to the video if its name starts with the
 * video's name, it's in Subs/<video name>/, it has the same episode number, or
 * the video is the only one in the folder.
 */
export function discoverSubtitles(videoPath: string): string[] {
  const dir = dirname(videoPath);
  const stem = basename(videoPath, extname(videoPath)).toLowerCase();
  const videoEp = episodeKey(stem);

  const top = list(dir);
  const onlyVideo = top.filter((e) => e.isFile() && VIDEO_EXTS.has(extname(e.name).toLowerCase())).length === 1;

  const found: string[] = [];
  const consider = (d: string, entries: Dirent[], inStemFolder: boolean) => {
    for (const e of entries) {
      if (!e.isFile() || !SUBTITLE_EXTS.has(extname(e.name).toLowerCase())) continue;
      const name = basename(e.name, extname(e.name)).toLowerCase();
      const rest = name.startsWith(stem) ? name.slice(stem.length) : null;
      const matches =
        (rest !== null && (rest === "" || /^[.\-_ [(]/.test(rest))) ||
        inStemFolder ||
        (videoEp !== null && episodeKey(name) === videoEp) ||
        onlyVideo;
      if (matches) found.push(join(d, e.name));
    }
  };

  consider(dir, top, false);
  for (const sd of top.filter((e) => e.isDirectory() && SUB_DIR.test(e.name))) {
    const subDir = join(dir, sd.name);
    const inner = list(subDir);
    consider(subDir, inner, false);
    for (const nd of inner.filter((e) => e.isDirectory() && e.name.toLowerCase() === stem)) {
      consider(join(subDir, nd.name), list(join(subDir, nd.name)), true);
    }
  }
  return found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** S01E02 → "s1e2"; anime "Show - 02" → "e2". */
export function episodeKey(name: string): string | null {
  const se = /s(\d{1,2})\s*e(\d{1,3})/i.exec(name);
  if (se) return `s${Number(se[1])}e${Number(se[2])}`;
  const dash = /\s-\s(\d{1,3})(?:v\d)?(?=$|[\s.[(])/.exec(name);
  if (dash) return `e${Number(dash[1])}`;
  return null;
}

function list(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
