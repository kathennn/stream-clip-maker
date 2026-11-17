#!/usr/bin/env node
// LAB: clip Twitch streams while they are live. Records each channel with Streamlink,
// reads its chat anonymously, runs the live peak detector and cuts each moment from the
// growing recording. Everything stays on this computer: nothing is uploaded.
//
//   node live-clips.mjs channel_a channel_b --minutes 20
//   node live-clips.mjs channel_a --chat-only          # detector only, no video
//
// Finding a public stream does not give permission to publish clips of it.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPeakDetector, LIVE_DEFAULTS } from "./engine/peaks.mjs";
import { twitchChat } from "./sources/twitch-irc.mjs";
import { hms, VERTICAL } from "./chat-clips.mjs";

const HELP = `live-clips <channel...> [options]   (lab: records and clips live Twitch streams)

  --out <dir>       lab folder (default lab)
  --quality <q>     streamlink quality (default best)
  --minutes <n>     stop after n minutes (default: run until Ctrl+C)
  --chat-only       no recording: just detect and log moments
  --vertical        also make a 9:16 version of each clip (re-encode, queued)
  --slack <s>       seconds of chat lateness tolerated before closing a window (default 3)
  detector: --window --lead --tail --max --skip --baseline --ratio --min (same as chat-clips)
`;

function parse(argv) {
  const o = { out: "lab", quality: "best", minutes: 0, slack: 3, channels: [] };
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

let allowed = [];
try { allowed = JSON.parse(readFileSync(new URL("./rules.json", import.meta.url), "utf8")).allowedCreators || []; } catch { /* no rules */ }
for (const c of o.channels) {
  if (!allowed.map((x) => String(x).toLowerCase()).includes(c)) {
    console.error(`! ${c} is not in rules.json allowedCreators: clips are for local testing only, do not publish them.`);
  }
}

// --- per channel state -------------------------------------------------------------------
const chans = new Map();
for (const name of o.channels) {
  const dir = join(o.out, name);
  mkdirSync(join(dir, "clips"), { recursive: true });
  const ch = {
    name, dir,
    rec: o["chat-only"] ? null : join(dir, `${stamp}.ts`),
    recStart: o["chat-only"] ? Date.now() : null, // ms epoch of the recording's first byte
    proc: null, messages: 0, ignored: 0, cuts: 0, lastDrift: null,
  };
  ch.detector = createPeakDetector(detectorOpts, { onMoment: (m) => onMoment(ch, m) });
  chans.set(name, ch);
}

// Seconds of video in the growing recording (ffprobe reads first and last timestamps).
function recDuration(ch) {
  if (!ch.rec || !existsSync(ch.rec)) return 0;
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ch.rec], { encoding: "utf8" });
  const d = Number(String(r.stdout).trim());
  return Number.isFinite(d) ? d : 0;
}

function startRecording(ch) {
  const args = ["--retry-streams", "30", "--retry-max", "0", "--force", "-o", ch.rec, `twitch.tv/${ch.name}`, o.quality];
  if (twitchAdsFlag) args.unshift(twitchAdsFlag);
  ch.proc = spawn("streamlink", args, { stdio: ["ignore", "ignore", "pipe"] });
  ch.proc.stderr.setEncoding("utf8");
  ch.proc.stderr.on("data", (s) => {
    for (const line of s.split("\n").filter(Boolean)) {
      if (/ad|filter|error|offline|waiting|retry/i.test(line)) log("STREAMLINK", { channel: ch.name, line: line.slice(0, 200), at: new Date().toISOString() });
    }
  });
  ch.proc.on("exit", (code) => log("STREAMLINK_EXIT", { channel: ch.name, code }));
  const poll = setInterval(() => {
    if (existsSync(ch.rec) && statSync(ch.rec).size > 0) {
      ch.recStart = Date.now();
      log("RECORDING", { channel: ch.name, file: ch.rec, at: new Date(ch.recStart).toISOString() });
      clearInterval(poll);
    }
  }, 250);
}

// --- cutting ---------------------------------------------------------------------------------
const queue = [];
let busy = false;
function enqueue(job) { queue.push(job); if (!busy) drain(); }
async function drain() {
  busy = true;
  while (queue.length) await queue.shift()();
  busy = false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function onMoment(ch, m) {
  const detectedWall = Date.now();
  const entry = { channel: ch.name, ...m, peakAt: new Date(ch.recStart + m.peak * 1000).toISOString(), detectedWall: new Date(detectedWall).toISOString() };
  log("MOMENT", entry);
  if (!ch.rec) { appendFileSync(join(ch.dir, "moments.jsonl"), JSON.stringify(entry) + "\n"); return; }
  enqueue(async () => {
    // The chat clock runs from the first recorded byte; the file loses time on skipped ads
    // and starts a few seconds behind live. Measure that drift now and correct for it.
    let dur = recDuration(ch);
    const elapsed = (Date.now() - ch.recStart) / 1000;
    const drift = +(elapsed - dur).toFixed(2);
    ch.lastDrift = drift;
    const start = Math.max(0, m.start - drift), end = m.end - drift;
    for (let i = 0; i < 20 && dur < end + 2; i++) { await sleep(1000); dur = recDuration(ch); }
    const name = `clip_${String(++ch.cuts).padStart(2, "0")}_${hms(m.peak).replaceAll(":", "-")}`;
    const out = join(ch.dir, "clips", `${name}.mp4`);
    const t0 = Date.now();
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(start), "-i", ch.rec, "-t", String(end - start),
      "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero", out], { encoding: "utf8" });
    const ok = r.status === 0 && existsSync(out);
    Object.assign(entry, { drift, fileStart: +start.toFixed(2), fileEnd: +end.toFixed(2), clip: ok ? out : null,
      cutMs: Date.now() - t0, readyAfterPeakS: +((Date.now() - (ch.recStart + m.peak * 1000)) / 1000).toFixed(1),
      error: ok ? undefined : String(r.stderr).slice(0, 300) });
    if (ok && o.vertical) {
      const v = join(ch.dir, "clips", `${name}_9x16.mp4`);
      const t1 = Date.now();
      const rv = spawnSync("nice", ["-n", "10", "ffmpeg", "-y", "-v", "error", "-i", out, "-filter_complex", VERTICAL,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", v]);
      entry.vertical = rv.status === 0 ? v : null;
      entry.verticalMs = Date.now() - t1;
    }
    log("CLIP", entry);
    appendFileSync(join(ch.dir, "moments.jsonl"), JSON.stringify(entry) + "\n");
  });
}

// --- main ------------------------------------------------------------------------------------
let twitchAdsFlag = null;
if (!o["chat-only"]) {
  const v = spawnSync("streamlink", ["--help"], { encoding: "utf8" });
  if (v.error) { console.error("streamlink not found: install it or use --chat-only"); process.exit(1); }
  if (String(v.stdout).includes("--twitch-disable-ads")) twitchAdsFlag = "--twitch-disable-ads";
  for (const ch of chans.values()) startRecording(ch);
}

const ac = new AbortController();
let stopping = false;
async function stop(why) {
  if (stopping) return;
  stopping = true;
  log("STOP", { why });
  ac.abort();
  for (const ch of chans.values()) {
    if (ch.recStart) ch.detector.flush();
    ch.proc?.kill("SIGINT");
  }
  while (busy || queue.length) await sleep(500);
  for (const ch of chans.values()) {
    log("SUMMARY", { channel: ch.name, messages: ch.messages, ignoredBeforeRecording: ch.ignored, ...ch.detector.snapshot(),
      recordedS: ch.rec ? +recDuration(ch).toFixed(1) : null, lastDrift: ch.lastDrift,
      fileMB: ch.rec && existsSync(ch.rec) ? +(statSync(ch.rec).size / 1e6).toFixed(1) : null });
  }
  process.exit(0);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
if (o.minutes > 0) setTimeout(() => stop(`${o.minutes} minutes`), o.minutes * 60000);

// Close windows during silence, a few seconds behind the clock so late chat still counts.
setInterval(() => {
  for (const ch of chans.values()) if (ch.recStart) ch.detector.tick((Date.now() - ch.recStart) / 1000 - o.slack);
}, 2000);
setInterval(() => {
  for (const ch of chans.values()) {
    log("STATUS", { channel: ch.name, messages: ch.messages, ...ch.detector.snapshot(),
      recordedS: ch.rec ? +recDuration(ch).toFixed(1) : null,
      elapsedS: ch.recStart ? +((Date.now() - ch.recStart) / 1000).toFixed(1) : null });
  }
}, 60000);

for await (const m of twitchChat(o.channels, { signal: ac.signal, onStatus: (s) => s.event !== "joined" && log("CHAT", s) })) {
  const ch = chans.get(m.channel);
  if (!ch) continue;
  if (!ch.recStart) { ch.ignored++; continue; }
  ch.messages++;
  ch.detector.push({ t: (m.ts - ch.recStart) / 1000, user: m.user, text: m.text });
}
