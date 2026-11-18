import type { ServerWebSocket } from "bun";
import index from "../client/index.html";
import { nowMs } from "../shared/clock.ts";
import { cuePlainText, type ClientMsg, type PlaybackState, type ServerMsg, type Track } from "../shared/protocol.ts";
import type { LatencyStats } from "./stats.ts";

export interface ServerOptions {
  port: number;
  hostname: string;
  token: string;
  tls?: { cert: string; key: string };
  stats: LatencyStats;
  getTrack(): Track;
  getState(): PlaybackState | null;
}

type WS = ServerWebSocket<{ authed: true }>;

export function startServer(opts: ServerOptions) {
  const clients = new Set<WS>();
  const send = (ws: WS, msg: ServerMsg) => ws.send(JSON.stringify(msg));

  const server = Bun.serve<{ authed: true }>({
    port: opts.port,
    hostname: opts.hostname,
    tls: opts.tls ? { cert: Bun.file(opts.tls.cert), key: Bun.file(opts.tls.key) } : undefined,
    development: false,
    routes: {
      "/": index,
      "/stats": () => Response.json(opts.stats.report()),
      "/manifest.webmanifest": () =>
        new Response(JSON.stringify(manifest(opts.token)), { headers: { "content-type": "application/manifest+json" } }),
    },
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        if (url.searchParams.get("t") !== opts.token) return new Response("bad token", { status: 403 });
        if (srv.upgrade(req, { data: { authed: true } })) return;
        return new Response("upgrade failed", { status: 400 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: false, // tiny messages; compression only adds latency
      open(ws) {
        clients.add(ws);
        send(ws, { type: "hello", version: 1 });
        send(ws, { type: "track", track: opts.getTrack() });
        const st = opts.getState();
        if (st) send(ws, { type: "state", state: st });
      },
      close(ws) {
        clients.delete(ws);
      },
      message(ws, raw) {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.type === "ping") {
          send(ws, { type: "pong", t0: msg.t0, ts: nowMs() });
        } else if (msg.type === "rendered") {
          const track = opts.getTrack();
          if (msg.generation !== track.generation) return;
          const texts = msg.cueIds.map((id) => track.cues[id]).filter((c) => c != null).map((c) => cuePlainText(c));
          opts.stats.rendered(texts, msg.ts);
        }
      },
    },
  });

  const broadcast = (msg: ServerMsg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) ws.send(data);
  };

  return { server, broadcast, clientCount: () => clients.size };
}

/** start_url carries the token so a home-screen launch can connect. */
function manifest(token: string) {
  return {
    name: "Subtitle Mirror",
    short_name: "Subtitles",
    start_url: `/?t=${token}`,
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
  };
}
