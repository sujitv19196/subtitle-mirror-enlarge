import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Per-user state dir: ~/Library/Application Support/submirror, %APPDATA%\submirror, or ~/.config/submirror. */
export function configDir(): string {
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  const dir = join(base, "submirror");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Stable across runs so home-screen shortcuts and bookmarks keep working. */
export function loadOrCreateToken(): string {
  const file = join(configDir(), "token");
  if (existsSync(file)) {
    const t = readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{16,}$/.test(t)) return t;
  }
  const t = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  writeFileSync(file, t + "\n", { mode: 0o600 });
  return t;
}
