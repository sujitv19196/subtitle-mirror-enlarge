/** Desktop UI ⇄ sidecar messages, one JSON object per line over stdin/stdout. */

export type TunerId = "generic" | "anime";

export type UiMsg =
  | { type: "probe"; video: string }
  /** Use this subtitle file (no tracks were found); answered with a one-source "sources". */
  | { type: "useSub"; video: string; path: string }
  | { type: "start"; video: string; sourceId: number; tuner: TunerId }
  | { type: "stop" };

export interface SourceInfo {
  id: number;
  label: string;
}

export type SidecarMsg =
  | { type: "ready" }
  | { type: "sources"; video: string; sources: SourceInfo[]; skippedImage: string[] }
  | { type: "progress"; text: string }
  | { type: "started"; url: string; lanUrl: string | null; qrSvg: string }
  | { type: "ended" }
  | { type: "log"; text: string }
  | { type: "error"; message: string };
