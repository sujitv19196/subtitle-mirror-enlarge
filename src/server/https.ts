import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.ts";
import { installHint } from "./install-hint.ts";

export interface TlsFiles {
  cert: string;
  key: string;
  /** mkcert's root CA; install it on the phone once. */
  rootCA: string;
}

/** Issues (or reuses) an mkcert certificate for the given hosts (IPs or names). */
export async function ensureLocalCert(hosts: string[]): Promise<TlsFiles> {
  const mkcert = Bun.which("mkcert");
  if (!mkcert) throw new Error(`--https needs mkcert: ${installHint("mkcert")} && mkcert -install`);

  const caRoot = (await new Response(Bun.spawn([mkcert, "-CAROOT"], { stdout: "pipe" }).stdout).text()).trim();
  const rootCA = join(caRoot, "rootCA.pem");
  if (!existsSync(rootCA)) throw new Error("mkcert has no local CA yet: run `mkcert -install` once");

  const dir = join(configDir(), "certs");
  mkdirSync(dir, { recursive: true });
  const names = [...new Set([...hosts, "localhost"])];
  const id = names.join("_").replace(/[^\w.-]/g, "-");
  const cert = join(dir, `${id}.pem`);
  const key = join(dir, `${id}-key.pem`);
  if (!existsSync(cert) || !existsSync(key)) {
    const proc = Bun.spawn([mkcert, "-cert-file", cert, "-key-file", key, ...names], {
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await proc.exited) !== 0) throw new Error(`mkcert failed: ${await new Response(proc.stderr).text()}`);
  }
  return { cert, key, rootCA };
}

export const IPHONE_CA_STEPS = (rootCA: string) => `First time on iPhone — trust the local CA so the page counts as secure:
  1. AirDrop ${rootCA} to the phone (or email it to yourself)
  2. Settings → Profile Downloaded → Install
  3. Settings → General → About → Certificate Trust Settings → enable "mkcert …"`;
