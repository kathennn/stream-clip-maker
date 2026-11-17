<!--
  Stream Clip Maker README
  Official Stream Clip Maker brand assets.
-->

<div align="center">
  <img src="assets/stream-clip-maker-icon.png" alt="Stream Clip Maker app icon" width="144" />
  <img src="assets/stream-clip-maker-wordmark.png" alt="Stream Clip Maker" width="92%" />

  <h1>Stream Clip Maker</h1>
  <p><strong>Find the moment. Cut the highlight. Share the clip.</strong></p>
  <p>Turn Twitch and YouTube stream chat reactions into ranked highlights and vertical videos.</p>

  <p>
    <a href="https://www.npmjs.com/package/stream-clip-maker"><img src="https://img.shields.io/npm/v/stream-clip-maker?style=for-the-badge&logo=npm&logoColor=white&label=npm" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/stream-clip-maker"><img src="https://img.shields.io/npm/dm/stream-clip-maker?style=for-the-badge&logo=npm&logoColor=white&label=downloads" alt="npm monthly downloads" /></a>
    <a href="https://github.com/kathennn/stream-clip-maker/stargazers"><img src="https://img.shields.io/github/stars/kathennn/stream-clip-maker?style=for-the-badge&logo=github&label=stars" alt="GitHub stars" /></a>
    <a href="https://github.com/kathennn/stream-clip-maker/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kathennn/stream-clip-maker?style=for-the-badge" alt="MIT license" /></a>
    <img src="https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 18 or newer" />
  </p>

  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#how-it-works">How it works</a> ·
    <a href="LEEME.md">Leer en español</a> ·
    <a href="https://kathennn.github.io/stream-clip-maker/">Website & downloads</a> ·
    <a href="https://github.com/kathennn/stream-clip-maker/releases/tag/v0.1.0">Release v0.1.0</a> ·
    <a href="https://github.com/kathennn/stream-clip-maker/issues">Report a bug</a>
  </p>
</div>

---

## The best moments are already in the chat.

A sudden flood of emotes. Everyone typing at once. A reaction spike you don't want to miss.

**Stream Clip Maker** analyzes chat activity, finds standout moments, and helps turn them into shareable clips — without manually scrubbing through an entire VOD.

## Why Stream Clip Maker?

| Feature | What it does |
| --- | --- |
| **Chat-powered discovery** | Finds reaction spikes using unique chatters and reaction signals. |
| **Twitch + YouTube chat** | Supports TwitchDownloader chat JSON and YouTube live-chat replay JSONL. |
| **Highlight ranking** | Scores and merges nearby peaks into reviewable clip candidates. |
| **Vertical video** | Creates 9:16 clips with a blurred background. |
| **Local-first workflow** | Runs on your machine; no hosted processing service required. |
| **Creator review** | Keeps the workflow review-first instead of automatically publishing content. |

## How it works

<div align="center">
  <img src="assets/stream-clip-maker-banner.svg" alt="Workflow: stream chat, reaction detection, highlight selection, vertical clip" width="100%" />
</div>

1. **Get the chat replay** from a Twitch VOD or YouTube livestream.
2. **Analyze reactions** to find windows with unusually high viewer activity.
3. **Review candidates** and choose the moments worth clipping.
4. **Render vertical clips** with FFmpeg.
5. **Review and share** only content you have permission to reuse.

## Desktop downloads — v0.1.0

Official desktop installers for Linux x64 and Windows x64. Each link downloads directly from the public GitHub release.

| Platform | Package | Direct download |
| --- | --- | --- |
| Linux Debian / Ubuntu | DEB | [Download DEB](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker_0.1.0_amd64.deb) |
| Linux Fedora | RPM | [Download RPM](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker-0.1.0-1.x86_64.rpm) |
| Linux portable | AppImage | [Download AppImage](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker_0.1.0_amd64.AppImage) |
| Windows | MSI | [Download MSI](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker_0.1.0_x64_en-US.msi) |
| Windows | EXE | [Download EXE](https://github.com/kathennn/stream-clip-maker/releases/download/v0.1.0/Stream.Clip.Maker_0.1.0_x64-setup.exe) |

Linux: install DEB/RPM with your package manager. For AppImage, run chmod +x on the downloaded file and launch it. Windows: run the MSI or EXE installer.

**macOS:** this release has no supported native desktop installer. Use the guided TUI from a source checkout:

    git clone https://github.com/kathennn/stream-clip-maker.git
    cd stream-clip-maker
    npm install
    node cli.mjs

Install Node.js 18+, FFmpeg and the download tools needed by your workflow. The menu includes Search, Create, Enhance, Share, Setup & Help and Check. Rendering and publishing require confirmation; nothing is auto-published.

The desktop app processes files locally. Install FFmpeg and whichever of yt-dlp / TwitchDownloaderCLI your workflow needs. See the [official download website](https://kathennn.github.io/stream-clip-maker/).

## Interactive terminal interface

Run Stream Clip Maker without arguments to open the guided TUI:

```bash
stream-clip-maker
```

Choose an action from the menu and follow the prompts to analyze a chat, create clips from a Twitch VOD / supported URL / local video, discover Twitch streams, or add subtitles and a title to a vertical clip. The interface asks for confirmation before starting video rendering. It never publishes videos automatically.

Advanced users can keep using the original flags and scripts; for example, `stream-clip-maker chat.json --vertical --top 5`.

## Quick start

### 1. Install

Requires **Node.js 18+**.

```bash
npm install --global stream-clip-maker
```

Or run it without a global install:

```bash
npx stream-clip-maker
```

### 2. Download a chat replay

**Twitch**

```bash
TwitchDownloaderCLI chatdownload --id <VOD_ID> -o chat.json
```

**YouTube live chat replay**

```bash
yt-dlp --skip-download --write-subs --sub-langs live_chat -o stream "<YOUTUBE_URL>"
```

### 3. Find highlight moments

**Twitch VOD**

```bash
stream-clip-maker chat.json --vod <VOD_ID> --vertical
```

**YouTube replay**

```bash
stream-clip-maker stream.live_chat.json --url "<YOUTUBE_URL>" --vertical
```

### 4. Render your clips

Preview the plan first. This writes `moments.json` but never starts a downloader or renderer, even if `--run` is also present:

```bash
stream-clip-maker chat.json --vod <VOD_ID> --preview --run --out clips
```

After reviewing the moments, select which numbered candidates to render with `--select`:

```bash
stream-clip-maker chat.json --vod <VOD_ID> --vertical --select 1,3 --run --out clips
```

You can also render from a local video:

```bash
stream-clip-maker chat.json --video recording.mp4 --vertical --run --out clips
```

Open the guided interface with `stream-clip-maker`, or see advanced options with:

```bash
stream-clip-maker --help
```

## How it works

- Chat is grouped into **10-second windows**.
- Each window is scored using unique chatters and the share of those chatters posting reaction messages.
- Windows dominated by repeated, poll-like messages are down-weighted.
- Candidate moments must exceed a rolling baseline and minimum-reactor thresholds.
- Nearby peaks are merged into a clip, up to the configured maximum duration.
- The first three minutes are skipped by default to reduce greeting-related spikes.

The detector is heuristic, not an AI model. Chat reactions may refer to what the streamer says or does, not only the game. Always review the selected moments and rendered clips.

## Vertical video

The `--vertical` option creates a **9:16** version with a blurred background. Automatic face tracking and smart subject reframing are not currently included.

## Requirements

| Tool | Needed for |
| --- | --- |
| **Node.js 18+** | Running the CLI |
| **FFmpeg** | Cutting and rendering video |
| **TwitchDownloaderCLI** | Downloading Twitch VOD chat / media |
| **yt-dlp** | Downloading YouTube media and chat replay |
| **Whisper.cpp** *(optional)* | Speech transcription for the Termux subtitle workflow |

The core chat-analysis command has no third-party Node.js runtime dependencies. Downloading and rendering media requires the relevant external tools.

## Android / Termux extras

The repository also includes optional scripts for the project's Android workflow:

| Script | Purpose |
| --- | --- |
| `discover-twitch.sh` | Search live Twitch channels and archived VODs by category using Twitch Helix. |
| `make-clips.sh` | Download Twitch chat, detect moments, render vertical clips, add Spanish captions/title, and copy outputs to Downloads. |
| `enhance-clip.sh` | Transcribe Spanish speech with Whisper.cpp and burn in title/subtitles. |
| `youtube-auth.mjs` | Configure local YouTube OAuth. |
| `youtube-upload.mjs` | Validate and upload a final Short as private. |
| `publish-short.sh` | Wrapper for the review-first YouTube upload flow. |

These helpers require additional local tools and configuration. They are not a hosted service and do not publish automatically.

### Twitch discovery setup

1. Create an application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Copy `.env.example` to `.env`.
3. Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in `.env`.
4. Add creator logins you have permission to edit to `allowedCreators` in `rules.json`.
5. Run the discovery script from your repository checkout:

```bash
./discover-twitch.sh "GTA 6"
```

**Discovery is not permission.** Finding a channel through Twitch's API does not grant rights to reuse its content. Only creators explicitly listed in `allowedCreators` should be treated as authorized by your local workflow.

### YouTube upload safety

The upload helper:
- Requires the explicit `--confirm-rights` flag.
- Accepts only files ending in `_final.mp4`.
- Checks for **1080×1920** resolution and a duration of up to **180 seconds**.
- Uploads as **private** for manual review.

Review the clip, creator permissions, title, and description before publishing.

## ChatGPT plugins

The repository includes two ready-to-import, skills-only plugin packages:

- [Stream Clip Maker assistant — ZIP](plugins/stream-clip-maker-assistant.zip): helps ChatGPT guide installation, Twitch/YouTube chat analysis, desktop and TUI use, rendering and troubleshooting.
- [Remote Desktop Commander Guide — ZIP](plugins/remote-desktop-commander-guide.zip): explains device connection, terminal sessions, file operations, Git/deployment workflows and security.

To use one with ChatGPT, download its ZIP and add it through Plugin Creator / the plugin import flow available in your ChatGPT account. Once saved, select the plugin in a conversation and describe the task.

**Important:** these are instruction/skill plugins, not remote execution servers. The Remote Desktop Commander Guide does not grant computer access. Connect the official Remote Desktop Commander integration separately, authorize your device, and then use the guide alongside it. See the plugin folders for full instructions.

## Development

Clone the repository:

```bash
git clone https://github.com/kathennn/stream-clip-maker.git
cd stream-clip-maker
npm test
npm pack --dry-run
```

## Contributing

Bug reports, feature requests, and pull requests are welcome. Please include reproduction steps and relevant environment details, but never attach API keys, OAuth credentials, private chat logs, or copyrighted media you do not have permission to share.

## License

Released under the [MIT License](LICENSE).

---

<div align="center">
  <strong>Made for creators who don't want to miss the moment.</strong>
  <br />
  <sub>If Stream Clip Maker helps your workflow, consider giving the project a star.</sub>
</div>
