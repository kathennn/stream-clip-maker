# Live clipping lab: findings and proposed architecture

Status: lab spike, 2026-11-17. Local branch, not proposed for merge yet. Everything below
was measured on one Linux PC (Arch, Node 22, Streamlink 8.6.3, FFmpeg) unless marked
**untested**.

## Goal

Detect clip-worthy moments **while a stream is live** and cut them from the stream as it
is recorded, for two kinds of users:

1. **Streamer**: clips their own stream from OBS on their own PC.
2. **Clipper**: watches several other creators' live channels at once.

Both share the same detector. Only the sources of chat and video differ.

```
             chat source                        video source
 streamer:   own channel chat (IRC)             OBS (recording or replay buffer)
 clipper:    N channels on one IRC connection   Streamlink, one recording per channel
                        \                         /
                         v                       v
                 createPeakDetector()  ->  moment {start, peak, end}
                 (one per channel)              |
                                                v
                                   cut from the growing recording
                                   (ffmpeg -c copy, then optional 9:16)
```

## What was built in the lab branch

| File | What it does |
|---|---|
| `chat-clips.mjs` | Unchanged scoring. Window helpers (`newWindow`, `addToWindow`, `scoreWindow`) and named exports; `main()` runs only when the file is executed directly. Batch output is byte-identical (golden test). |
| `engine/peaks.mjs` | `createPeakDetector(opts, {onWindow, onMoment})` with `push / tick / flush / snapshot`. Pure, no I/O, one instance per channel. |
| `sources/twitch-irc.mjs` | Read-only anonymous Twitch chat (`justinfan`) over `node:tls`. Uses Twitch's own send time (`tmi-sent-ts`) and the stable `user-id`. Several channels on one connection; PING/PONG, RECONNECT, backoff. Node 18 compatible. |
| `live-clips.mjs` | Lab runner: Streamlink recording + live chat + detector + cut from the growing `.ts`. Writes `moments.jsonl` and `*.windows.jsonl` (every window, for tuning). Prints `MOMENT {json}` / `CLIP {json}` lines, the format the Tauri app already pipes to the UI. |
| `test/peaks.test.mjs` | 9 offline tests on a deterministic synthetic chat (spikes, a copypasta poll, quiet chat, warm-up, silence). |

### How the live detector differs from the batch one

The scoring of a 10 s window is the same code. What changes is what cannot be known live:

- **Floor**: batch uses the median of the whole stream. Live uses the median of the windows
  seen so far, and `--skip` (180 s) doubles as the warm-up.
- **Peak test**: a window must beat the next one, so a peak is known one window (10 s) later.
- **When a moment is reported**: once no later peak can join it (`lead + tail` seconds after
  its last peak). By then its clip end is already in the recording.
- **No top-N**: every moment over the thresholds is reported.
- **Memory**: a ring of the last `baseline/window` scores; per-window `Set`s are released
  once a window can no longer be a peak or neighbour.

On a steady synthetic chat the live detector finds exactly the same moments as batch.

## Measurements

### Anonymous Twitch chat (2026-11-17)

- Works without account or token. Connected immediately to 30 channels on one connection.
- Chat arrives about 1.4 s after Twitch stamps it.
- 12 minutes, 2 channels, chat only: 4,782 + 1,373 messages, no disconnections, no
  out-of-order messages.
- Caveat: anonymous login is community practice, not a documented Twitch API.

### Detector on real chat (chat only, 12 min)

- `caseoh_` (6.6 msg/s): 0 moments.
- `lacy` (gambling stream, 1.9 msg/s): 2 moments, both **false positives**. Chat was
  spamming slot-game suggestions ("@Lacy try 666", "PHOENIX DUEL REELS"); only 4 of 24
  people used a reaction. The poll filter misses it because each person writes a different
  game. Candidate fix: a minimum reaction share, or treating `@streamer` requests as
  non-reactions. Needs more data before changing.
- Report latency: about 50 s after the peak (by design: `lead + tail` + one window).

### Recording and cutting while live (Test A, 1 channel)

_Pending: filled in from `lab/A` (clip accuracy, drift, latency, CPU/RAM/disk)._

### Several channels at once (Test B, 3 channels)

_Pending._

## Streamer profile: OBS without GPL code

Our internal prototype (game-copilot) controls OBS through `obsws-python`, which is
**GPL-3.0**, so none of that code can come into this MIT project. The protocol itself is
simple enough to speak directly (checked against the official obs-websocket v5 docs):

1. Connect to `ws://127.0.0.1:4455`. Node 22 has a global `WebSocket`; Node 18 would need
   a dependency.
2. Server sends **Hello** (`op 0`) with `authentication: {challenge, salt}` when a
   password is set.
3. Client sends **Identify** (`op 1`) with `rpcVersion: 1` and
   `authentication = base64(sha256(base64(sha256(password + salt)) + challenge))`
   (`node:crypto`).
4. Requests (`op 6`): `GetReplayBufferStatus`, `StartReplayBuffer`, `SaveReplayBuffer`,
   then `GetLastReplayBufferReplay` gives `savedReplayPath`.

Proposed flow for the streamer:

- Chat source: the same anonymous IRC on the streamer's own channel.
- Video source, either:
  - **OBS recording** (most streamers record anyway): cut from the growing file exactly like
    the Streamlink path; or
  - **Replay buffer**: on each moment call `SaveReplayBuffer` and cut with
    `-sseof` from the saved file. The buffer must be longer than detection latency + clip
    length (about 50 s + 90 s), so 300 s is a safe setting.
- Password: read from the user's OBS config or an env var, never logged.

**Untested** in this repo: OBS path, YouTube live chat, Kick chat.

## Open questions

1. Ad breaks: Streamlink 8 drops ads by default, which leaves gaps; the runner measures the
   drift between wall clock and recorded time at each cut and corrects for it.
2. Threshold tuning for very large chats and for non-gaming categories (gambling, polls).
3. YouTube live chat (no IRC; polling) and Kick (websocket, no stable public API).
4. Permissions: discovery is not authorization. The runner warns when a channel is not in
   `rules.json` `allowedCreators`; clips stay local.
5. Desktop app: allowlist `live-clips.mjs` in `src-tauri/src/lib.rs` and add a stop command
   for long-running tasks.

## Related prior art

A third-party Python script shared on Instagram (`gta6-clip-watcher`, by @aiverse.pranav,
not reviewed and no code taken) describes the same clipper pipeline for one channel:
Streamlink from the first second, anonymous chat counted every 10 s, a spike at 3x recent
normal with at least 20 messages, 30 s cut while recording, Whisper captions. Our detector
adds unique people, reaction weighting, poll detection and a median baseline.
