#!/usr/bin/env node
// LAB: clip Twitch streams while they are live. Records each channel with Streamlink,
// reads its chat anonymously, runs the live peak detector and cuts each moment from the
// recording. Everything stays on this computer: nothing is uploaded.
//
//   node live-clips.mjs channel_a channel_b --minutes 20
//   node live-clips.mjs channel_a --chat-only          # detector only, no video
//
// Finding a public stream does not give permission to publish clips of it.
//
// Timing model: everything is wall-clock time. The recording is written as short segments
// named after the second they were opened (ffmpeg segment muxer, strftime %s), so a moment
// is cut by wall-clock time. Skipped ads, timestamp jumps and a stream that ends and restarts
// cannot shift the cut, they only leave gaps.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, statSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPeakDetector, LIVE_DEFAULTS } from "./engine/peaks.mjs";
import { twitchChat } from "./sources/twitch-irc.mjs";
import { hms, VERTICAL } from "./chat-clips.mjs";

const HELP = `live-clips <channel...> [options]   (lab: records and clips live Twitch streams)

  --out <dir>       lab folder (default lab)
  --quality <q>     streamlink quality (default best)
  --minutes <n>     stop after n minutes (default: run until Ctrl+C)
  --chat-only       no recording: just detect and log moments
  --vertical        also make a 9:16 version of each clip (re-encode, queued)
  --offset <s>      shift cuts by s seconds (positive = later) (default 0)
  --slack <s>       seconds of chat lateness tolerated before closing a window (default 3)
  detector: --window --lead --tail --max --skip --baseline --ratio --min (same as chat-clips)
`;

// Chat bots and !commands are not people reacting to the stream.
const BOTS = new Set(["nightbot", "streamelements", "streamlabs", "moobot", "fossabot", "wizebot", "sery_bot",
  "soundalerts", "botrixoficial", "kofistreambot", "pokemoncommunitygame", "streamstickers"]);
const isNoise = (m) => m.text.startsWith("!") || BOTS.has(String(m.name).toLowerCase());

function parse(argv) {
  const o = { out: "lab", quality: "best", minutes: 0, slack: 3, offset: 0, channels: [] };
  const flags = new Set(["chat-only", "vertical", "help"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { o.channels.push(a.toLowerCase()); continue; }
    const k = a.slice(2);
    if (flags.has(k)) { o[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    o[k] = ["out", "quality"].includes(k) ? v : Number(v);
    if (Number.isNaN(o[k])) throw new Error(`${a} needs a number`);
  }
  return o;
}

const o = parse(process.argv.slice(2));
if (o.help || !o.channels.length) { process.stdout.write(HELP); process.exit(o.help ? 0 : 1); }
const detectorOpts = Object.fromEntries(Object.keys(LIVE_DEFAULTS).filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const log = (tag, obj) => console.log(`${tag} ${JSON.stringify(obj)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();

// Never block the event loop: chat keeps flowing while ffmpeg works.
function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { if (err.length < 2000) err += d; });
    p.on("error", (e) => resolve({ code: -1, err: e.message }));
    p.on("close", (code) => resolve({ code, err }));
  });
}

let allowed = [];
try { allowed = JSON.parse(readFileSync(new URL("./rules.json", import.meta.url), "utf8")).allowedCreators || []; } catch { /* no rules */ }
for (const c of o.channels) {
  if (!allowed.map((x) => String(x).toLowerCase()).includes(c)) {
    console.error(`! ${c} is not in rules.json allowedCreators: clips are for local testing only, do not publish them.`);
  }
}

// --- per channel state -------------------------------------------------------------------
// The detector clock: seconds since `origin` (ms epoch), set when the first segment of the
// channel appears (or at start with --chat-only). Moments convert back to wall time.
const chans = new Map();
for (const name of o.channels) {
  const dir = join(o.out, name);
  mkdirSync(join(dir, "clips"), { recursive: true });
  const ch = {
    name, dir, segDir: join(dir, `seg-${stamp}`),
    origin: o["chat-only"] ? Date.now() : null,
    live: false, procs: [], messages: 0, noise: 0, ignored: 0, cuts: 0, lags: [], restarts: 0,
    chatLog: join(dir, `${stamp}.chat.jsonl`),
  };
  const wlog = join(dir, `${stamp}.windows.jsonl`);
  ch.detector = createPeakDetector(detectorOpts, {
    onMoment: (m) => onMoment(ch, m),
    onWindow: (w) => appendFileSync(wlog, JSON.stringify({ start: w.start, msgs: w.msgs, people: w.people.size,
      reacting: w.reactors.size, vote: w.vote, score: +w.score.toFixed(1), base: +w.base.toFixed(1), ratio: +w.ratio.toFixed(2) }) + "\n"),
  });
  chans.set(name, ch);
}

// Segments on disk: [{ file, wall (ms epoch at open), bytes }], oldest first.
function segments(ch) {
  if (!existsSync(ch.segDir)) return [];
  return readdirSync(ch.segDir)
    .filter((f) => /^\d+-\d+\.ts$/.test(f))
    .map((f) => ({ file: join(ch.segDir, f), wall: Number(f.split("-")[0]) * 1000, bytes: statSync(join(ch.segDir, f)).size }))
    .sort((a, b) => a.wall - b.wall);
}

function startRecording(ch) {
  mkdirSync(ch.segDir, { recursive: true });
  const sl = spawn("streamlink", ["--twitch-low-latency", "--retry-streams", "30", "--retry-max", "0", "--stdout",
    `twitch.tv/${ch.name}`, o.quality], { stdio: ["ignore", "pipe", "pipe"] });
  // %s = epoch second the segment was opened; the counter keeps names unique within a second.
  const ff = spawn("ffmpeg", ["-hide_banner", "-v", "error", "-i", "pipe:0", "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
    "-f", "segment", "-segment_time", "6", "-reset_timestamps", "1", "-strftime", "1",
    join(ch.segDir, `%s-${ch.restarts}.ts`)], { stdio: ["pipe", "ignore", "pipe"] });
  sl.stdout.pipe(ff.stdin);
  ff.stdin.on("error", () => {});
  ch.procs = [sl, ff];
  sl.stderr.setEncoding("utf8");
  sl.stderr.on("data", (s) => {
    for (const line of s.split("\n").filter(Boolean)) {
      if (/ad|filter|error|offline|waiting|retry|ended|discontinu/i.test(line)) log("STREAMLINK", { channel: ch.name, line: line.slice(0, 200), at: iso(Date.now()) });
    }
  });
  ff.stderr.on("data", (d) => log("FFMPEG", { channel: ch.name, line: String(d).slice(0, 200) }));
  const poll = setInterval(() => {
    const segs = segments(ch);
    if (segs.length && !ch.live) {
      ch.live = true;
      if (!ch.origin) ch.origin = segs[0].wall;
      log("RECORDING", { channel: ch.name, dir: ch.segDir, firstSegment: iso(segs[0].wall) });
    }
  }, 500);
  sl.on("exit", (code) => {
    clearInterval(poll);
    const was = ch.live;
    ch.live = false;
    log("STREAM_END", { channel: ch.name, code, wasRecording: was, at: iso(Date.now()) });
    if (!stopping) { ch.restarts++; setTimeout(() => startRecording(ch), 5000); } // wait for the next stream
  });
}

// --- cutting ---------------------------------------------------------------------------------
const queue = [];
let busy = false;
function enqueue(job) { queue.push(job); if (!busy) drain(); }
async function drain() {
  busy = true;
  while (queue.length) {
    try { await queue.shift()(); } catch (e) { log("ERROR", { error: e.message }); }
  }
  busy = false;
}

function onMoment(ch, m) {
  const wallStart = ch.origin + (m.start + o.offset) * 1000;
  const wallEnd = ch.origin + (m.end + o.offset) * 1000;
  const peakWall = ch.origin + m.peak * 1000;
  const entry = { channel: ch.name, ...m, peakAt: iso(peakWall), detectedAt: iso(Date.now()) };
  log("MOMENT", entry);
  if (o["chat-only"]) { appendFileSync(join(ch.dir, "moments.jsonl"), JSON.stringify(entry) + "\n"); return; }
  enqueue(async () => {
    // Wait until a segment opened after the clip end exists (the end is on disk), up to 30 s.
    let segs = segments(ch);
    for (let i = 0; i < 30 && !(segs.length && segs.at(-1).wall > wallEnd); i++) { await sleep(1000); segs = segments(ch); }
    const need = segs.filter((s, k) => (segs[k + 1]?.wall ?? Infinity) > wallStart && s.wall < wallEnd);
    if (!need.length) {
      Object.assign(entry, { clip: null, error: "no recording covers this moment (stream offline or ended)" });
      log("CLIP", entry);
      appendFileSync(join(ch.dir, "moments.jsonl"), JSON.stringify(entry) + "\n");
      return;
    }
    const name = `clip_${String(++ch.cuts).padStart(2, "0")}_${hms(m.peak).replaceAll(":", "-")}`;
    const list = join(ch.dir, "clips", `${name}.txt`);
    writeFileSync(list, need.map((s) => `file '${resolve(s.file)}'`).join("\n") + "\n");
    const ss = Math.max(0, (wallStart - need[0].wall) / 1000);
    const out = join(ch.dir, "clips", `${name}.mp4`);
    const t0 = Date.now();
    const r = await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-ss", ss.toFixed(2),
      "-t", ((wallEnd - wallStart) / 1000).toFixed(2), "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy",
      "-avoid_negative_ts", "make_zero", out]);
    const ok = r.code === 0 && existsSync(out);
    const gaps = need.slice(1).filter((s, k) => s.wall - need[k].wall > 9000).length;
    Object.assign(entry, { segments: need.length, gaps, clip: ok ? out : null, cutMs: Date.now() - t0,
      readyAfterPeakS: +((Date.now() - peakWall) / 1000).toFixed(1), error: ok ? undefined : r.err.slice(0, 300) });
    if (ok && o.vertical) {
      const v = join(ch.dir, "clips", `${name}_9x16.mp4`);
      const t1 = Date.now();
      const rv = await run("nice", ["-n", "10", "ffmpeg", "-y", "-v", "error", "-i", out, "-filter_complex", VERTICAL,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", v]);
      entry.vertical = rv.code === 0 ? v : null;
      entry.verticalMs = Date.now() - t1;
      entry.verticalReadyAfterPeakS = +((Date.now() - peakWall) / 1000).toFixed(1);
    }
    log("CLIP", entry);
    appendFileSync(join(ch.dir, "moments.jsonl"), JSON.stringify(entry) + "\n");
  });
}

// --- main ------------------------------------------------------------------------------------
let stopping = false;
if (!o["chat-only"]) {
  for (const bin of ["streamlink", "ffmpeg"]) {
    if (spawnSync(bin, ["--version"]).error) { console.error(`${bin} not found: install it or use --chat-only`); process.exit(1); }
  }
  for (const ch of chans.values()) startRecording(ch);
}

const ac = new AbortController();
const segStats = (ch) => {
  const segs = segments(ch);
  return { segments: segs.length, recordedMB: +(segs.reduce((a, s) => a + s.bytes, 0) / 1e6).toFixed(1) };
};
async function stop(why) {
  if (stopping) return;
  stopping = true;
  log("STOP", { why });
  ac.abort();
  for (const ch of chans.values()) {
    if (ch.origin) ch.detector.flush();
    for (const p of ch.procs) p.kill("SIGINT");
  }
  await sleep(1500);
  while (busy || queue.length) await sleep(500);
  for (const ch of chans.values()) {
    const lag = [...ch.lags].sort((a, b) => a - b);
    const pct = (p) => (lag.length ? lag[Math.min(lag.length - 1, Math.floor(p * lag.length))] : null);
    log("SUMMARY", { channel: ch.name, messages: ch.messages, noise: ch.noise, ignoredBeforeRecording: ch.ignored,
      restarts: ch.restarts, ...ch.detector.snapshot(), lagMs: { p50: pct(0.5), p95: pct(0.95), max: lag.at(-1) ?? null },
      ...segStats(ch) });
  }
  process.exit(0);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
if (o.minutes > 0) setTimeout(() => stop(`${o.minutes} minutes`), o.minutes * 60000);

// Close windows during silence, a few seconds behind the clock so late chat still counts.
setInterval(() => {
  for (const ch of chans.values()) if (ch.origin) ch.detector.tick((Date.now() - ch.origin) / 1000 - o.slack);
}, 2000);
setInterval(() => {
  for (const ch of chans.values()) {
    log("STATUS", { channel: ch.name, live: ch.live, messages: ch.messages, noise: ch.noise, ...ch.detector.snapshot(), ...segStats(ch) });
  }
}, 60000);

for await (const m of twitchChat(o.channels, { signal: ac.signal, onStatus: (s) => s.event !== "joined" && log("CHAT", s) })) {
  const ch = chans.get(m.channel);
  if (!ch) continue;
  if (!ch.origin) { ch.ignored++; continue; }
  if (ch.lags.length < 20000) ch.lags.push(Date.now() - m.ts); // network + clock skew
  // raw chat for offline threshold tuning (lab folder, never committed)
  appendFileSync(ch.chatLog, JSON.stringify({ t: +((m.ts - ch.origin) / 1000).toFixed(3), user: m.user, name: m.name, text: m.text }) + "\n");
  if (isNoise(m)) { ch.noise++; continue; }
  ch.messages++;
  ch.detector.push({ t: (m.ts - ch.origin) / 1000, user: m.user, text: m.text });
}
