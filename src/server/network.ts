import { hostname, networkInterfaces } from "node:os";

export function lanAddress(): string | null {
  const ifs = networkInterfaces();
  for (const name of ["en0", "en1", ...Object.keys(ifs)]) {
    for (const a of ifs[name] ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

/**
 * Bonjour name (e.g. "MacBook-Pro.local"), stable across DHCP changes unlike the IP.
 * macOS only for now; Windows' mDNS responder isn't reliable enough to rely on.
 */
export function localHostName(): string | null {
  if (process.platform !== "darwin") return null;
  const out = Bun.spawnSync(["scutil", "--get", "LocalHostName"]);
  const name = out.success ? out.stdout.toString().trim() : hostname().replace(/\.local$/, "");
  return name ? `${name}.local` : null;
}
