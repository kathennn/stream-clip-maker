#!/usr/bin/env node
// Stream Clip Maker: find clip-worthy moments in a stream by looking at chat spikes.
// Zero dependencies. Reads a TwitchDownloader chat JSON or a yt-dlp live_chat
// replay (JSON Lines), scores 10-second windows by how many different people
// react, and prints the top moments plus ready-to-run cut commands.
//
//   node chat-clips.mjs chat.json --vod 2345678901
//   node chat-clips.mjs video.live_chat.json --url https://youtu.be/XXXX
//   node chat-clips.mjs chat.json --video stream.mp4 --run --out clips

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename } from "node:path";

const HELP = `stream-clip-maker <chat-file> [options]

Input: TwitchDownloader JSON (chatdownload) or yt-dlp *.live_chat.json

Options:
  --window <s>     window size in seconds            (default 10)
  --lead <s>       seconds before the peak to start  (default 20)
  --tail <s>       seconds after the peak to end     (default 15)
  --max <s>        longest clip when peaks merge     (default 90)
  --skip <s>       ignore the first seconds of the chat (greetings) (default 180)
  --top <n>        how many moments to keep          (default 10)
  --baseline <s>   rolling baseline length           (default 300)
  --ratio <x>      min score vs baseline to count    (default 2.5)
  --min <n>        min people reacting in a window   (default 5)
  --simple         count raw messages only (no people/reaction weighting)
  --vod <id>       Twitch VOD id  -> TwitchDownloaderCLI commands
  --url <url>      any yt-dlp URL -> yt-dlp --download-sections commands
  --video <file>   local recording -> ffmpeg commands
  --vertical       add a 9:16 pass (blurred background) to each clip
  --out <dir>      output folder for clips and moments.json (default clips)
  --preview        write the plan without starting download or render tools
  --select <n,...> render only selected 1-based moment numbers (for example 1,3)
  --run            execute the generated commands
`;

// Reaction tokens, Spanish and English. Matching any of them marks the message
// as a reaction; the share of reacting people boosts the window score.
const REACTION = new RegExp(
  [
    "j[aeiu]j[aeiu]j?", "ja{2,}", "x+d+", "kek", "kekw", "lmao+", "lol+", "omg+",
    "no{3,}", "nooo", "wtf", "qu[eé]+\\s*(fue|paso|pasó)", "clip", "clipea",
    "pog+", "(^|\\s)f+(\\s|$)", "\\bbro+\\b", "😂", "🤣", "💀", "😱", "😭", "🔥", "‼", "!!!",
  ].join("|"),
  "i",
);

function parseArgs(argv) {
  const opts = { window: 10, lead: 20, tail: 15, max: 90, skip: 180, top: 10, baseline: 300, ratio: 2.5, min: 5, out: "clips" };
  const flags = new Set(["simple", "run", "vertical", "preview", "help"]);
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { file = a; continue; }
    const key = a.slice(2);
    if (flags.has(key)) { opts[key] = true; continue; }
    const val = argv[++i];
    if (val === undefined) throw new Error(`missing value for ${a}`);
    opts[key] = ["vod", "url", "video", "out", "select"].includes(key) ? val : Number(val);
    if (Number.isNaN(opts[key])) throw new Error(`${a} needs a number`);
  }
  return { file, opts };
}

// Returns [{ t: seconds, user: string, text: string }]
function loadChat(path) {
  const raw = readFileSync(path, "utf8");
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{") && trimmed.includes('"comments"')) {
    try { return fromTwitch(JSON.parse(raw)); } catch { /* fall through to JSONL */ }
  }
  return fromYouTube(raw);
}

function fromTwitch(data) {
  return (data.comments || []).map((c) => ({
    t: Number(c.content_offset_seconds),
    user: String(c.commenter?._id ?? c.commenter?.name ?? c.commenter?.display_name ?? "?"),
    text: c.message?.body ?? (c.message?.fragments || []).map((f) => f.text).join(""),
  })).filter((m) => Number.isFinite(m.t));
}

function fromYouTube(raw) {
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const replay = row.replayChatItemAction;
    if (!replay) continue;
    const t = Number(replay.videoOffsetTimeMsec) / 1000;
    for (const action of replay.actions || []) {
      const r = action.addChatItemAction?.item?.liveChatTextMessageRenderer
        || action.addChatItemAction?.item?.liveChatPaidMessageRenderer;
      if (!r) continue;
      const text = (r.message?.runs || [])
        .map((run) => run.text ?? run.emoji?.shortcuts?.[0] ?? run.emoji?.emojiId ?? "")
        .join("");
      out.push({ t, user: r.authorExternalChannelId || r.authorName?.simpleText || "?", text });
    }
  }
  return out.filter((m) => Number.isFinite(m.t) && m.t >= 0);
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Collapse "siiii", "JAJAJA", "100" variants so repeated votes look identical.
const norm = (s) => s.toLowerCase().replace(/\d+/g, "#").replace(/(.)\1+/g, "$1").replace(/[^\p{L}#]/gu, "");

// Chat text is written by strangers: drop control characters (terminal escape sequences) and
// bidi overrides before it is printed or saved.
const clean = (s) => s.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");

function scoreWindows(msgs, o) {
  // Windows start at the first message, not at 0: a chat downloaded from the middle of a VOD
  // (TwitchDownloaderCLI -b/-e) must not count the hours before it as silence.
  let first = Infinity, last = -Infinity;
  for (const m of msgs) { if (m.t < first) first = m.t; if (m.t > last) last = m.t; }
  const n = Math.floor((last - first) / o.window) + 1;
  const wins = Array.from({ length: n }, (_, i) => ({
    i, start: first + i * o.window, msgs: 0, people: new Set(), reactors: new Set(), words: new Map(), sample: [],
  }));
  wins.first = first;
  for (const m of msgs) {
    const w = wins[Math.floor((m.t - first) / o.window)];
    w.msgs++;
    w.people.add(m.user);
    const reacting = REACTION.test(m.text);
    if (reacting) w.reactors.add(m.user);
    const key = norm(m.text);
    if (key && !reacting) w.words.set(key, (w.words.get(key) || 0) + 1);
    if (w.sample.length < 6 && m.text) w.sample.push(clean(m.text).slice(0, 40));
  }
  for (const w of wins) {
    const people = w.people.size;
    w.share = people ? w.reactors.size / people : 0;
    // A window where one non-reaction message dominates is a poll or a
    // copypasta ("100", "si"), not something happening on screen.
    const top = Math.max(0, ...w.words.values());
    w.vote = w.msgs >= 10 && top / w.msgs > 0.4;
    w.score = o.simple ? w.msgs : people * (1 + 2 * w.share) * (w.vote ? 0.4 : 1);
  }
  // Baseline: median of the previous few minutes, never below the median of
  // the whole stream (so the first minutes do not look like a spike).
  const back = Math.max(1, Math.round(o.baseline / o.window));
  const floor = Math.max(1, median(wins.map((w) => w.score)));
  wins.forEach((w, k) => {
    const prev = wins.slice(Math.max(0, k - back), k).map((x) => x.score);
    w.base = Math.max(floor, prev.length >= back / 2 ? median(prev) : floor);
    w.ratio = w.score / w.base;
    w.excess = w.score - w.base;
  });
  return wins;
}

function pickMoments(wins, o) {
  const cand = wins.filter((w, k) =>
    w.start >= wins.first + o.skip &&
    w.ratio >= o.ratio &&
    (o.simple ? w.score >= o.min : w.people.size >= o.min) &&
    w.score >= (wins[k - 1]?.score ?? 0) &&
    w.score >= (wins[k + 1]?.score ?? 0));
  // Peaks close together are one moment: the clip grows to cover them all,
  // up to --max seconds, and keeps the strongest window as its peak.
  const groups = [];
  for (const w of cand.sort((a, b) => a.start - b.start)) {
    const g = groups[groups.length - 1];
    const fits = g && w.start - g.last.start <= o.lead + o.tail &&
      w.start + o.window + o.tail - g.start <= o.max;
    if (fits) {
      g.last = w;
      if (w.excess > g.best.excess) g.best = w;
    } else groups.push({ start: Math.max(0, w.start - o.lead), last: w, best: w });
  }
  return groups
    .sort((a, b) => b.best.excess - a.best.excess)
    .slice(0, o.top)
    .map(({ start, last, best: w }) => ({
      peak: w.start,
      start,
      end: last.start + o.window + o.tail,
      duration: last.start + o.window + o.tail - start,
      people: w.people.size,
      messages: w.msgs,
      reacting: w.reactors.size,
      vote: w.vote,
      score: +w.score.toFixed(1),
      baseline: +w.base.toFixed(1),
      ratio: +w.ratio.toFixed(1),
      sample: w.sample,
    }))
    .sort((a, b) => a.start - b.start);
}

const hms = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
};

const VERTICAL =
  "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[bg];" +
  "[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p";

function commandsFor(m, k, o) {
  const name = `clip_${String(k + 1).padStart(2, "0")}_${hms(m.peak).replaceAll(":", "-")}`;
  const raw = join(o.out, `${name}.mp4`);
  const cmds = [];
  if (o.vod) {
    cmds.push(["TwitchDownloaderCLI", "videodownload", "--id", o.vod, "-b", hms(m.start), "-e", hms(m.end), "-q", "1080p60", "-o", raw]);
  } else if (o.url) {
    cmds.push(["yt-dlp", "--download-sections", `*${hms(m.start)}-${hms(m.end)}`, "--force-keyframes-at-cuts", "-f", "bv*[height<=1080]+ba/b", "--merge-output-format", "mp4", "-o", raw, o.url]);
  } else if (o.video) {
    cmds.push(["ffmpeg", "-y", "-ss", hms(m.start), "-to", hms(m.end), "-i", o.video, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", raw]);
  }
  if (o.vertical && cmds.length) {
    cmds.push(["ffmpeg", "-y", "-i", raw, "-filter_complex", VERTICAL, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", join(o.out, `${name}_9x16.mp4`)]);
  }
  return cmds;
}

const quote = (a) => (/^[\w./:=@+-]+$/.test(a) ? a : `"${a.replaceAll('"', '\\"')}"`);

function parseSelection(value, momentCount) {
  if (value === undefined) return null;
  const selected = value.split(",").map((part) => Number(part.trim()));
  if (selected.some((index) => !Number.isInteger(index) || index < 1 || index > momentCount)) {
    throw new Error(`--select needs moment numbers from 1 to ${momentCount}`);
  }
  return [...new Set(selected)];
}

function main() {
  const { file, opts } = parseArgs(process.argv.slice(2));
  if (!file || opts.help) { process.stdout.write(HELP); process.exit(opts.help ? 0 : 1); }
  const msgs = loadChat(file);
  if (!msgs.length) throw new Error(`no chat messages found in ${basename(file)}`);

  const wins = scoreWindows(msgs, opts);
  const moments = pickMoments(wins, opts);
  const selection = parseSelection(opts.select, moments.length);
  const selected = new Set(selection ?? moments.map((_, index) => index + 1));
  const dur = hms(wins.length * opts.window);
  console.log(`${msgs.length} messages · ${dur} of stream · ${moments.length} moments\n`);

  mkdirSync(opts.out, { recursive: true });
  const all = [];
  moments.forEach((m, k) => {
    console.log(`#${k + 1}  ${hms(m.start)} → ${hms(m.end)}   peak ${hms(m.peak)}   ` +
      `${m.people} people (${m.reacting} reacting) · x${m.ratio} vs normal${m.vote ? " · looks like a poll" : ""}`);
    console.log(`     chat: ${m.sample.join(" | ")}`);
    if (!selected.has(k + 1)) {
      console.log("     not selected for rendering\n");
      return;
    }
    const cmds = commandsFor(m, k, opts);
    cmds.forEach((c) => console.log(`     $ ${c.map(quote).join(" ")}`));
    all.push(...cmds);
    console.log();
  });
  writeFileSync(join(opts.out, "moments.json"), JSON.stringify({ source: basename(file), options: opts, selected: [...selected], moments }, null, 2));
  console.log(`moments saved to ${join(opts.out, "moments.json")}`);

  if (opts.preview) {
    console.log("Preview only: no downloads or rendering were started.");
  } else if (opts.run) {
    if (!all.length) { console.error("--run needs --vod, --url or --video"); process.exit(1); }
    for (const [bin, ...args] of all) {
      console.log(`\n▶ ${bin} ${args.map(quote).join(" ")}`);
      const r = spawnSync(bin, args, { stdio: "inherit" });
      if (r.error || r.status !== 0) {
        console.error(`✗ ${bin} failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}`);
        process.exit(1);
      }
    }
    console.log(`\nDone. Clips in ${opts.out}/`);
  }
}

try { main(); } catch (e) { console.error(`stream-clip-maker: ${e.message}`); process.exit(1); }
