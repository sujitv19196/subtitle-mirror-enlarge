#!/usr/bin/env bun
/**
 * Puts the sidecar, ffmpeg, ffprobe and mpv where `tauri build` expects them, for the host platform.
 * On macOS, set APPLE_SIGNING_IDENTITY to sign the bundled binaries for notarization.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const MPV_VERSION = "v0.42.0";

interface Target {
  triple: string;
  bunTarget: string;
  exe: string;
  mpvAsset: string;
  mpvSha256: string;
}

const TARGETS: Record<string, Target> = {
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    bunTarget: "bun-darwin-arm64",
    exe: "",
    mpvAsset: `mpv-${MPV_VERSION}-macos-15-arm.zip`,
    mpvSha256: "be1b8d2445e6880860869c080b8710dee189721f1fa4689840db6a2c10d7be69",
  },
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    bunTarget: "bun-windows-x64",
    exe: ".exe",
    mpvAsset: `mpv-${MPV_VERSION}-x86_64-pc-windows-msvc.zip`,
    mpvSha256: "8dd69cbab079086765fa5d873c09513b2834b85d146c1301718a757e8c0595ef",
  },
};

const root = resolve(import.meta.dir, "..");
const tauriDir = join(root, "app/src-tauri");
const binDir = join(tauriDir, "binaries");
const resDir = join(tauriDir, "resources");
const cacheDir = join(root, "node_modules/.cache/submirror-mpv");

const target = TARGETS[`${process.platform}-${process.arch}`];
if (!target) die(`no desktop build for ${process.platform}-${process.arch}; supported: ${Object.keys(TARGETS).join(", ")}`);
/** 1.4.0's --compile writes an invalid macOS code signature, so the sidecar gets killed at launch. */
if (!Bun.semver.satisfies(Bun.version, ">=1.4.5")) die(`Bun ${Bun.version} is too old to build the sidecar; run \`bun upgrade\` (need 1.4.5+)`);

rmSync(binDir, { recursive: true, force: true });
rmSync(resDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(resDir, { recursive: true });

step("sidecar");
const sidecar = join(binDir, `submirror-sidecar-${target.triple}${target.exe}`);
await sh([process.execPath, "build", "--compile", "--minify", `--target=${target.bunTarget}`, join(root, "src/app/sidecar.ts"), "--outfile", sidecar]);

step("ffmpeg / ffprobe");
copyBin(require("ffmpeg-static") as string, `ffmpeg${target.exe}`);
copyBin(require("@ffprobe-installer/ffprobe").path as string, `ffprobe${target.exe}`);

step(`mpv ${MPV_VERSION}`);
const extracted = await fetchMpv(target);
if (process.platform === "darwin") {
  cpSync(join(extracted, "mpv.app"), join(resDir, "mpv.app"), { recursive: true, verbatimSymlinks: true });
} else {
  for (const f of ["mpv.exe", "vulkan-1.dll"]) cpSync(join(extracted, f), join(resDir, f));
}

step("licenses");
mkdirSync(join(resDir, "licenses"), { recursive: true });
cpSync(join(root, "THIRD_PARTY.md"), join(resDir, "licenses/THIRD_PARTY.md"));
cpSync(join(root, "LICENSE"), join(resDir, "licenses/LICENSE"));
cpSync(join(root, "node_modules/ffmpeg-static/ffmpeg.LICENSE"), join(resDir, "licenses/ffmpeg.LICENSE"));

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (process.platform === "darwin" && identity) {
  step("signing bundled binaries");
  await signMac(identity);
} else if (process.platform === "darwin") {
  console.log("APPLE_SIGNING_IDENTITY not set: bundled binaries left unsigned (fine for local builds)");
}
step("done");

function copyBin(src: string, name: string): void {
  if (!existsSync(src)) die(`missing ${src}; run \`bun install\``);
  const dest = join(resDir, name);
  cpSync(src, dest);
  chmodSync(dest, 0o755);
}

/** Downloads (cached) and checksum-verifies the pinned mpv build; returns the extracted folder. */
async function fetchMpv(t: Target): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const zip = join(cacheDir, t.mpvAsset);
  if (!existsSync(zip) || sha256(zip) !== t.mpvSha256) {
    const url = `https://github.com/mpv-player/mpv/releases/download/${MPV_VERSION}/${t.mpvAsset}`;
    console.log(`downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) die(`download failed: ${res.status} ${url}`);
    await Bun.write(zip, res);
  }
  const actual = sha256(zip);
  if (actual !== t.mpvSha256) die(`checksum mismatch for ${t.mpvAsset}: ${actual}`);

  const out = join(cacheDir, t.mpvAsset.replace(/\.zip$/, ""));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  /** Windows' bsdtar reads zips; Git's GNU tar, often earlier on PATH in CI, doesn't. */
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  await sh([tar, "-xf", zip, "-C", out]);
  /** The macOS zip wraps a tarball so symlinks and permissions survive. */
  if (existsSync(join(out, "mpv.tar.gz"))) await sh(["tar", "-xzf", join(out, "mpv.tar.gz"), "-C", out]);
  return out;
}

/** Inside-out: dylibs, then executables, then the mpv.app bundle. Tauri signs the sidecar and the app itself. */
async function signMac(identity: string): Promise<void> {
  const entitlements = join(tauriDir, "Entitlements.plist");
  const sign = (path: string, withEntitlements = false) =>
    sh(["codesign", "--force", "--timestamp", "--options", "runtime", ...(withEntitlements ? ["--entitlements", entitlements] : []), "--sign", identity, path]);

  const app = join(resDir, "mpv.app/Contents");
  const dylibs = [...new Bun.Glob("{MacOS/lib,Frameworks}/*.dylib").scanSync({ cwd: app })];
  for (const d of dylibs) await sign(join(app, d));
  await sign(join(app, "MacOS/mpv"), true);
  await sign(join(resDir, "mpv.app"), true);
  await sign(join(resDir, "ffmpeg"));
  await sign(join(resDir, "ffprobe"));
  console.log(`signed ${dylibs.length} dylibs, mpv, ffmpeg, ffprobe`);
}

function sha256(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
}

async function sh(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) die(`failed: ${cmd.join(" ")}`);
}

function step(name: string): void {
  console.log(`\n== ${name}`);
}

function die(msg: string): never {
  console.error(`stage-binaries: ${msg}`);
  process.exit(1);
}
