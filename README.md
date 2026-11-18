# Subtitle Mirror

Mirror the subtitles of whatever you're watching on your computer to your phone, in sync, in large, readable type you control. It's an accessibility tool: the TV or laptop stays as it is for everyone else, and your phone becomes a personal caption display.

It plays the video in [mpv](https://mpv.io), follows mpv's playback clock, and serves a small web app over your Wi-Fi. The phone keeps its own copy of the clock, so lines appear on time even when Wi-Fi is jittery. Measured latency is a few milliseconds on the same machine (see [Latency](#latency)).

## Requirements

- macOS (Windows support is planned; the code already handles its named pipes)
- [Bun](https://bun.sh) 1.4+
- mpv: `brew install mpv`
- A phone on the same Wi-Fi network

You don't need to install ffmpeg yourself. It's bundled through npm (`ffmpeg-static`, `@ffprobe-installer/ffprobe`).

## Setup

```sh
git clone <this repo> && cd subtitle-mirror-enlarge
bun install
```

## Usage

```sh
bun src/server/cli.ts "<path to video>"
```

1. If the video has more than one subtitle track, the terminal lists them and you type a number.
2. mpv opens and starts playing.
3. Scan the QR code in the terminal with your phone, or type the URL printed under it.

Control playback on the computer as usual: the mpv window, keyboard, or media keys. The phone only displays.

For anime, use the anime tuner and pick the Japanese audio:

```sh
bun src/server/cli.ts "[Group] Show - 01.mkv" --tuner anime -- --alang=jpn
```

Anything after `--` is passed straight to mpv.

### Options

| Option | |
|---|---|
| `--sub <file>` | Use this subtitle file and skip searching |
| `--tuner <id>` | `generic` (default) or `anime` (see [Tuners](#tuners)) |
| `--port <n>` | HTTP port, default `8787` |
| `--host <addr>` | Bind address, default `0.0.0.0` |
| `--https` | Serve HTTPS using mkcert (see [HTTPS](#https-keep-the-screen-on)) |
| `--cert <pem> --key <pem>` | Use your own TLS certificate instead |
| `--mpv <path>` | mpv binary, default `mpv` on `PATH` |
| `--stats-every <s>` | Print latency stats every *s* seconds, default `30` (`0` = off) |

Press Ctrl+C or close mpv to stop. If it doesn't exit, press Ctrl+C a second time to force it.

## Where subtitles come from

Without `--sub`, Subtitle Mirror offers every text subtitle it can find:

1. **Embedded tracks** in the video (ASS/SSA, SRT, WebVTT, mov_text). The track you pick is extracted with ffmpeg into `$TMPDIR/submirror-tracks/` and reused on later runs. A large remux takes a second or two the first time.
2. **Subtitle files** (`.srt`, `.ass`, `.ssa`, `.vtt`) in the video's folder, `Subs/` or `Subtitles/`, and `Subs/<video name>/`. A file counts as belonging to the video if:
   - its name starts with the video's name (`Show S01E01.en.srt`), or
   - it's in `Subs/<video name>/`, or
   - it has the same episode number (`S01E02`, or anime-style `Show - 02`), or
   - the video is the only one in its folder.

Image-based tracks (Blu-ray PGS, DVD VobSub) can't be read as text and are skipped.

mpv shows only the track you picked, so the computer and the phone always match.

## Tuners

Parsers read subtitle files as they are. Tuners decide what each line *is*:

- **`generic`**: every line is dialogue.
- **`anime`**: for fansub ASS files. It separates dialogue, on-screen signs and typesetting, and OP/ED lyrics, and drops karaoke effect lines. On the phone, signs appear in a smaller strip at the top and lyrics in italics with ♪. Each can be hidden in settings.

Frame-by-frame typesetting and layered duplicate lines are merged into a single line either way.

## On the phone

The ⚙ button opens display settings, saved per phone:

- text size, font (including Atkinson Hyperlegible and Lexend), weight
- color theme (white or yellow on black, black on white, cream)
- line and letter spacing, position, alignment
- keep the last line visible (dimmed) until the next one
- show or hide signs and song lyrics
- connection details: clock offset, round-trip time, subtitle track, screen wake lock status

The live text is in an `aria-live` region, so VoiceOver and braille displays read lines as they appear.

### Full screen on iPhone

iPhone Safari can't make a web page full screen, but a home-screen app can be. Tap the **add** button left of ⚙ for the steps, or do it yourself: **Share → Add to Home Screen**, then open **Subtitles** from your home screen. The link stays the same between runs and across IP changes, so you only add it once. It uses your Mac's `.local` name and a saved access token.

On Android, the first tap on the page switches to full screen.

### HTTPS: keep the screen on

Phones only allow a page to keep the screen awake (the Wake Lock API) over HTTPS. Over plain HTTP, Subtitle Mirror plays a tiny hidden looping video instead. This usually works, but it isn't guaranteed. ⚙ → Connection details shows which method is active.

For the reliable way, set up HTTPS once:

```sh
brew install mkcert
mkcert -install
bun src/server/cli.ts "<video>" --https
```

Then trust the certificate on your iPhone. The terminal prints where the file is.

1. AirDrop `rootCA.pem` to the phone.
2. Settings → **Profile Downloaded** → Install.
3. Settings → General → About → **Certificate Trust Settings** → turn on "mkcert".

Switching between HTTP and HTTPS changes the link, so re-add the home-screen app after switching.

## Troubleshooting

- **The page won't load from the QR code.** Some networks block `.local` names. Use the IP link printed under the QR code instead. Also check the phone is on the same Wi-Fi and not a guest network.
- **"no text subtitles found"**: the video has no embedded text track and no matching file. Pass one with `--sub`.
- **The phone dims or locks.** Tap the page once (this starts the keep-awake), use `--https`, or set Auto-Lock to Never while watching. If the phone does lock, the page reconnects and re-syncs when you unlock it.
- **The text is early or late.** Subtitle timing adjustments made in mpv (`z` / `Z`) carry over to the phone automatically.

## Latency

The server compares each line's appearance on the phone with the moment mpv itself showed it, and prints a summary every 30 seconds and again on exit:

```
latency (phone − mpv): steady n=20 p50=-0ms p95=+15ms ... | transition n=8 ...
```

*Steady* covers normal playback. *Transition* covers lines shown within a second of a pause, seek or speed change, and those include one network hop by design. Raw numbers are at `/stats` on the server.

## Development

```sh
bun test            # unit and integration tests (fake mpv, generated MKV)
bun run typecheck
```

```
src/
  shared/           protocol types and clock sync, used by server and phone
  server/
    cli.ts          entry point
    mpv.ts          mpv JSON IPC client
    sync.ts         mpv events → playback state + subtitle track
    server.ts       HTTP + websocket server
    stats.ts        latency measurement
    embedded/       ffprobe/ffmpeg: list and extract embedded tracks
    subtitles/
      parsers/      SRT, VTT, ASS (format only)
      tuners/       generic, anime (content interpretation)
      discover.ts   find subtitle files for a video
  client/           phone web app
test/
```

To add a tuner, write a `Tuner` in `src/server/subtitles/tuners/` and register it in `tuners/index.ts`.
