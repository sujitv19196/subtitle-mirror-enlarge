import { FFPROBE, run } from "./bin.ts";

export interface EmbeddedTrack {
  /** Absolute stream index in the container (ffmpeg's `-map 0:<index>`). */
  index: number;
  codec: string;
  lang?: string;
  title?: string;
  default: boolean;
  forced: boolean;
}

/** Codec → extension for text formats we can parse. Image-based codecs (PGS, VobSub) are absent. */
export const TEXT_CODECS: Record<string, { ext: string; copy: boolean }> = {
  ass: { ext: ".ass", copy: true },
  ssa: { ext: ".ass", copy: true },
  subrip: { ext: ".srt", copy: true },
  webvtt: { ext: ".vtt", copy: true },
  mov_text: { ext: ".srt", copy: false },
  text: { ext: ".srt", copy: false },
};

export const isTextTrack = (t: EmbeddedTrack) => t.codec in TEXT_CODECS;

interface ProbeJson {
  streams?: {
    index: number;
    codec_name?: string;
    tags?: { language?: string; title?: string };
    disposition?: { default?: number; forced?: number };
  }[];
}

export async function listSubtitleTracks(videoPath: string): Promise<EmbeddedTrack[]> {
  const out = await run(FFPROBE, [
    "-v", "error",
    "-select_streams", "s",
    "-show_entries", "stream=index,codec_name:stream_tags=language,title:stream_disposition=default,forced",
    "-of", "json",
    videoPath,
  ]);
  const json = JSON.parse(out) as ProbeJson;
  return (json.streams ?? []).map((s) => ({
    index: s.index,
    codec: s.codec_name ?? "unknown",
    lang: s.tags?.language,
    title: s.tags?.title,
    default: s.disposition?.default === 1,
    forced: s.disposition?.forced === 1,
  }));
}
