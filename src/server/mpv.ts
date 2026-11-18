import { EventEmitter } from "node:events";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Unix socket on macOS/Linux, named pipe on Windows; node:net connects to either. */
export function ipcPath(tag = String(process.pid)): string {
  return process.platform === "win32" ? `\\\\.\\pipe\\submirror-${tag}` : join(tmpdir(), `submirror-${tag}.sock`);
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export interface MpvEvents {
  event: [name: string, payload: Record<string, unknown>];
  close: [];
}

/** mpv JSON IPC client: https://mpv.io/manual/master/#json-ipc */
export class MpvClient extends EventEmitter<MpvEvents> {
  private sock: Socket | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private observers = new Map<number, (value: unknown) => void>();

  /** Connect, retrying until mpv has created the socket. */
  async connect(path: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        this.sock = await new Promise<Socket>((resolve, reject) => {
          const s = createConnection({ path });
          s.once("connect", () => resolve(s));
          s.once("error", reject);
        });
        break;
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`Could not connect to mpv IPC at ${path}: ${(e as Error).message}`);
        await Bun.sleep(50);
      }
    }
    this.sock.setNoDelay?.(true);
    this.sock.setEncoding("utf8");
    this.sock.on("data", (chunk: string) => this.onData(chunk));
    this.sock.on("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("mpv IPC closed"));
      this.pending.clear();
      this.emit("close");
    });
    this.sock.on("error", () => {});
  }

  close(): void {
    this.sock?.destroy();
  }

  command(...args: unknown[]): Promise<unknown> {
    const sock = this.sock;
    if (!sock) return Promise.reject(new Error("not connected"));
    const request_id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(request_id, { resolve, reject });
      sock.write(JSON.stringify({ command: args, request_id }) + "\n");
    });
  }

  getProperty<T = unknown>(name: string): Promise<T> {
    return this.command("get_property", name) as Promise<T>;
  }

  /** Fires with the current value, then on every change. */
  async observe(name: string, cb: (value: unknown) => void): Promise<void> {
    const id = this.nextId++;
    this.observers.set(id, cb);
    await this.command("observe_property", id, name);
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    if (typeof msg.request_id === "number" && this.pending.has(msg.request_id)) {
      const p = this.pending.get(msg.request_id)!;
      this.pending.delete(msg.request_id);
      if (msg.error === "success") p.resolve(msg.data);
      else p.reject(new Error(String(msg.error)));
      return;
    }
    if (typeof msg.event !== "string") return;
    if (msg.event === "property-change" && typeof msg.id === "number") {
      this.observers.get(msg.id)?.(msg.data);
      return;
    }
    this.emit("event", msg.event, msg);
  }
}
