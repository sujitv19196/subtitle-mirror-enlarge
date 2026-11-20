import { createSocket } from "node:dgram";
import { hostname, networkInterfaces } from "node:os";

/** Adapters that are never the phone's Wi-Fi: WSL/Hyper-V, Docker, VMs, VPNs. */
const VIRTUAL_IF = /^(vethernet|docker|br-|veth|virbr|vmnet|vboxnet|virtualbox|utun|tun|tap|wg|zt|tailscale)/i;

/** The LAN IP the phone should use: the default route's source address, else the first physical IPv4. */
export async function lanAddress(): Promise<string | null> {
  return (await defaultRouteAddress()) ?? firstInterfaceAddress();
}

/** Connecting a UDP socket only does a route lookup; no packets are sent. */
function defaultRouteAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const s = createSocket("udp4");
    const done = (addr: string | null) => {
      clearTimeout(timer);
      s.close();
      resolve(addr && addr !== "0.0.0.0" ? addr : null);
    };
    const timer = setTimeout(() => done(null), 500);
    s.on("error", () => done(null));
    s.connect(53, "192.0.2.1", () => done(s.address().address));
  });
}

function firstInterfaceAddress(): string | null {
  const ifs = networkInterfaces();
  for (const name of ["en0", "en1", ...Object.keys(ifs)]) {
    if (VIRTUAL_IF.test(name)) continue;
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
