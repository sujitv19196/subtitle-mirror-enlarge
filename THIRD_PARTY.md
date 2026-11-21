# Third-party software in the desktop app

The Subtitle Mirror desktop app bundles these programs unmodified, as separate executables. Subtitle Mirror itself is MIT-licensed (see `LICENSE`); these programs keep their own licenses.

| Program | Version | License | Source |
|---|---|---|---|
| mpv | v0.42.0 (official release builds) | GPL-2.0-or-later | https://github.com/mpv-player/mpv/tree/v0.42.0 · builds: https://github.com/mpv-player/mpv/releases/tag/v0.42.0 |
| FFmpeg (`ffmpeg`) | 6.x, via `ffmpeg-static` 5.3.0 (binaries release b6.1.1) | GPL-3.0-or-later | https://ffmpeg.org/download.html · builds: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1 |
| FFmpeg (`ffprobe`) | 4.4.x, via `@ffprobe-installer/ffprobe` 2.1.2 | LGPL-2.1 / GPL (per build) | https://ffmpeg.org/download.html · builds: https://github.com/SavageCore/node-ffprobe-installer |
| Bun runtime (inside the sidecar) | see `package.json` | MIT | https://github.com/oven-sh/bun |
| Tauri | 2.x | MIT / Apache-2.0 | https://github.com/tauri-apps/tauri |

mpv's bundled libraries (FFmpeg, libass, LuaJIT and others) are listed in its release notes. To get the exact source for any bundled binary, follow the links above, or open an issue and we'll provide it.
