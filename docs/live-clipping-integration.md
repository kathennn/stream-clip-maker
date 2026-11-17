# Live clipping integration (experimental)

This is the first experimental local capture runner for the clipper workflow. The desktop app now exposes a Live clipper page for its allowlist, chat-only test, capture start and graceful stop. The OBS streamer profile is not implemented yet.

## Requirements

- Node.js 18 or newer (the desktop release bundles Node.js; source/development runs use the installed Node executable)
- Streamlink
- FFmpeg and ffprobe from the same FFmpeg installation
- A Twitch channel you have permission to capture and clip

## Authorization is required

Before starting, add the channel login to `allowedCreators` in the local `rules.json`. The runner checks this list before creating output folders or opening the IRC connection. An empty list blocks all channels.

The allowlist is a local safety gate, not proof of copyright ownership or permission to publish. Review the applicable rights and platform terms yourself. Nothing is uploaded automatically; clips remain local and require manual review.

## Run

From a source checkout:

```sh
node live-clips.mjs your_authorized_channel --minutes 20
```

Chat-only detection (no video capture):

```sh
node live-clips.mjs your_authorized_channel --chat-only --minutes 5
```

When installed from npm, the executable is `stream-clip-maker-live`.

Useful options:

- `--quality best`: Streamlink quality (also accepts `source`, `worst`, or a resolution such as `1080p60`)
- `--vertical`: render a 9:16 version after the source clip is cut
- `--max-disk-gb 6`: stop recording a channel when its segment files reach the per-channel limit
- `--slack 3`: keep windows open briefly to accept delayed chat messages
- `--out lab`: choose the local output folder

The recording limit applies to captured video segments per channel. It is a hard stop, not automatic cleanup; review and remove old local recordings when appropriate. Generated clips and chat logs also consume disk space and are not included in that segment limit.

## Timing and gaps

Video is stored as short transport-stream segments named with their wall-clock start time. The runner probes each segment duration and maps the requested wall-clock interval onto the concatenated media timeline. This prevents an advertisement, reconnect or missing segment from shifting the clip start or end by the length of the gap.

Gaps are omitted rather than synthesized. Each clip record reports the number of gaps and estimated missing seconds. If the requested range contains no recorded media, no clip is created.

The initial cut uses stream copy for speed, so its boundaries remain subject to source keyframe placement. Frame-accurate cuts would require a re-encode and are not claimed by this prototype.

## Current limitations

- Twitch IRC anonymous login is an undocumented community mechanism; Twitch EventSub remains the planned official transport option.
- No OBS WebSocket capture path is implemented here.
- No YouTube or Kick live-chat adapter is included.
- The Tauri page currently provides allowlist, chat-only test, capture start/stop and optional 9:16 rendering; the full clip library/editor workflow is not included.
- The 6 GB per-channel default is a safety cap, not a storage-management system.
- Live network capture and real-stream timing still require end-to-end testing on channels that are explicitly authorized.


## Desktop app

The desktop build exposes a **Live clipper** page. Enter comma-separated Twitch channel logins, confirm that you have permission to capture them, and save the allowlist. The allowlist is stored in the app's local data directory in `rules.json`; the runner reads that file when it starts.

- **Test chat only (5 min)** connects to chat and detects moments without recording video.
- **Start live capture** starts Streamlink, FFmpeg and chat detection until stopped. You can optionally request a 9:16 vertical render.
- **Stop capture** requests a graceful shutdown, stops capture processes and lets queued clip jobs finish. Closing the desktop window also requests task shutdown and waits for active tasks to finish.

The desktop bundle includes the Node.js runtime, live runner and its local modules. Streamlink, FFmpeg and ffprobe still need to be installed and available on the system PATH. The app does not upload or publish live clips.
