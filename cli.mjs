#!/usr/bin/env node
import { diagnose } from "./engine/doctor.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cancel, confirm, intro, isCancel, outro, select, text, note, log,
} from "@clack/prompts";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const run = (args, options = {}) => spawnSync(process.execPath, [resolve(ROOT, "chat-clips.mjs"), ...args], {
  cwd: process.cwd(), stdio: "inherit", ...options,
});
const paint = {
  cyan: (s) => `\u001b[36m${s}\u001b[39m`,
  magenta: (s) => `\u001b[35m${s}\u001b[39m`,
  green: (s) => `\u001b[32m${s}\u001b[39m`,
  yellow: (s) => `\u001b[33m${s}\u001b[39m`,
  bold: (s) => `\u001b[1m${s}\u001b[22m`,
};
const cancelled = (value) => {
  if (isCancel(value)) {
    cancel("Cancelled. Nothing was started.");
    process.exit(0);
  }
  return value;
};
const askText = async (message, placeholder = "", validate) => cancelled(await text({ message, placeholder, validate }));
const askSelect = async (message, options) => cancelled(await select({ message, options }));
const askConfirm = async (message, initialValue = false) => cancelled(await confirm({ message, initialValue }));

function loadEnvFile() {
  const path = resolve(ROOT, "config/private/.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function launch(args, label) {
  note(args.map((x) => JSON.stringify(x)).join(" "), label);
  const result = run(args);
  if (result.error) throw result.error;
  if (result.status !== 0) note(`The command exited with code ${result.status ?? "unknown"}.`, "Process finished");
  else outro("Done. Check the output folder for your clips.");
}

async function searchStreams() {
  loadEnvFile();
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
    note("Open Setup & Help → Connect Twitch. Add your Twitch app keys to the .env file in the project folder, then return here. Never paste your secret into chat.", "Twitch is not connected yet");
    return;
  }
  const topic = await askText("What game or category should we search for?", "GTA 6", (v) => v.trim() ? undefined : "Enter a game or category.");
  note("We'll look for live channels and archived VODs. Finding a stream does NOT grant permission to reuse its content.", "Before you search");
  if (!await askConfirm(`Search Twitch for "${topic}" now?`, false)) return;
  const result = spawnSync(process.execPath, [resolve(ROOT, "discover-twitch.mjs"), topic], {
    cwd: process.cwd(), stdio: "inherit", env: { ...process.env, STREAM_CLIP_DISCOVERY_OUT: resolve(ROOT, "workspace/discovery/discovery.json") },
  });
  if (result.error) throw result.error;
  if (result.status === 0) outro(`Search complete. Results saved to ${resolve(ROOT, "workspace/discovery/discovery.json")}. Check creator permissions before using any video.`);
  else note(`Search exited with code ${result.status ?? "unknown"}.`, "Search finished");
}

async function createClips() {
  const chat = await askText("Chat replay file (JSON or JSONL)", resolve(ROOT, "workspace/chats/chat.json"), (v) => v.trim() ? undefined : "Choose a chat file.");
  if (!existsSync(resolve(chat))) {
    note(`I couldn't find: ${resolve(chat)}`, "File not found");
    return;
  }
  const source = await askSelect("Where is the video you want to clip?", [
    { value: "analysis", label: "Just find the best moments (no video rendering)" },
    { value: "twitch", label: "A Twitch VOD" },
    { value: "youtube", label: "A YouTube / supported video URL" },
    { value: "local", label: "A video already on this device" },
  ]);
  const args = [chat];
  if (source === "twitch") args.push("--vod", await askText("Twitch VOD ID", "1234567890", (v) => /^\d+$/.test(v.trim()) ? undefined : "Enter the numeric VOD ID."));
  if (source === "youtube") args.push("--url", await askText("Video URL", "https://www.youtube.com/watch?v=...", (v) => /^https?:\/\//i.test(v.trim()) ? undefined : "Enter a valid http or https URL."));
  if (source === "local") args.push("--video", await askText("Video file path", "./stream.mp4", (v) => existsSync(resolve(v)) ? undefined : "I couldn't find that video."));
  const top = await askText("How many highlight moments should we keep?", "10", (v) => /^\d+$/.test(v) && Number(v) > 0 ? undefined : "Enter a number greater than zero.");
  const vertical = await askConfirm("Create vertical 9:16 videos for Shorts / Reels / TikTok?", true);
  const output = await askText("Where should we save the results?", resolve(ROOT, "workspace/clips"));
  args.push("--top", top, "--out", output);
  if (vertical) args.push("--vertical");
  if (source !== "analysis") {
    note("Video rendering can take several minutes per clip. Nothing will be uploaded automatically.", "Ready to create");
    if (!await askConfirm("Do you have permission to use this content, and should rendering start now?", false)) {
      outro("No video processing was started.");
      return;
    }
    args.push("--run");
  }
  launch(args, "Your creation plan");
}

async function addCaptions() {
  const input = await askText("Choose an existing vertical MP4", resolve(ROOT, "workspace/clips/clip_9x16.mp4"), (v) => existsSync(resolve(v)) ? undefined : "I couldn't find that video.");
  const title = await askText("Text to show at the top of the video", "BEST MOMENT");
  note("This step uses Whisper.cpp to create Spanish subtitles and FFmpeg to burn them into the video. It may take a few minutes.", "Caption requirements");
  if (!await askConfirm("Start transcription and video rendering?", false)) return;
  const result = spawnSync("bash", [resolve(ROOT, "enhance-clip.sh"), resolve(input), title], { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status === 0) outro("Captions added. Your finished file ends with _final.mp4.");
  else note(`Enhancement exited with code ${result.status ?? "unknown"}.`, "Process finished");
}

async function shareVideo() {
  note([
    "SHARE YOUR FINISHED VIDEO",
    "",
    "1. Open YouTube Studio and review the finished _final.mp4 file.",
    "2. Confirm you own the video or have explicit permission from the creator.",
    "3. Connect YouTube in Setup & Help → Connect YouTube.",
    "4. Choose Share → Upload a finished video here.",
    "5. The uploader checks 1080×1920 and a duration of 1–180 seconds.",
    "6. The video is uploaded as PRIVATE, never public automatically.",
    "7. Open YouTube Studio, review title / captions / audience settings, then choose Public or Schedule yourself.",
    "",
    "Only upload content you have the right to use.",
  ].join("\n"), "YouTube publishing guide");
  const action = await askSelect("What would you like to do?", [
    { value: "upload", label: "Upload a finished video as PRIVATE" },
    { value: "guide", label: "Keep reading the publishing guide" },
    { value: "back", label: "Back to main menu" },
  ]);
  if (action !== "upload") return;
  const video = await askText("Path to your finished _final.mp4 file", resolve(ROOT, "workspace/clips/clip_final.mp4"), (v) => v.endsWith("_final.mp4") && existsSync(resolve(v)) ? undefined : "Choose an existing file whose name ends with _final.mp4.");
  const title = await askText("YouTube title", "My highlight #Shorts", (v) => v.trim() ? undefined : "Enter a title.");
  const description = await askText("Description (optional)", "Clip with subtitles #Shorts");
  const tags = await askText("Tags separated by commas (optional)", "gaming,highlights,shorts");
  note("The upload tool verifies the video and uploads it as PRIVATE. It will not make the video public.", "Final review");
  if (!await askConfirm("I have the rights to this video. Upload it privately to my connected YouTube account?", false)) {
    outro("Upload cancelled. No video was sent.");
    return;
  }
  const args = [resolve(ROOT, "youtube-upload.mjs"), resolve(video), title, "--confirm-rights"];
  if (description.trim()) args.push("--description", description);
  if (tags.trim()) args.push("--tags", tags);
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status === 0) outro("Private upload complete. Open YouTube Studio to review and publish when ready.");
  else note(`Upload exited with code ${result.status ?? "unknown"}.`, "Upload finished");
}

async function showGuide(topic) {
  const guides = {
    overview: [
      "THE SIMPLE WORKFLOW",
      "",
      "1. SET UP: connect Twitch for stream discovery and YouTube for uploads.",
      "2. SEARCH: find a game/category and review live streams or archived VODs.",
      "3. GET CHAT: use the bundled TwitchDownloaderCLI through make-clips.sh, or yt-dlp for a YouTube live-chat replay.",
      "4. CREATE: analyze the chat to find reaction spikes, then render selected moments as vertical 9:16 clips.",
      "5. CAPTIONS: use Whisper.cpp + FFmpeg to create Spanish subtitles and add a title.",
      "6. SHARE: upload the finished _final.mp4 privately, review it in YouTube Studio, then publish manually.",
      "",
      "The app never publishes publicly by itself. Always get permission before reusing a creator's content.",
    ],
    twitch: [
      "CONNECT TWITCH (ONE-TIME SETUP)",
      "",
      "1. Open https://dev.twitch.tv/console/apps and sign in.",
      "2. Register a new application. Give it a name such as Stream Clip Maker.",
      "3. Choose an appropriate category and set OAuth Redirect URL to http://localhost (the discovery tool uses the app client credentials flow).",
      "4. Create the app and copy its Client ID and Client Secret.",
      "5. Copy .env.example to config/private/.env.",
      "6. Open config/private/.env and fill in TWITCH_CLIENT_ID=... and TWITCH_CLIENT_SECRET=...",
      "7. Save it. Keep .env private; never commit it or send the secret to anyone.",
      "8. Return to Search. Enter a game/category and start the search.",
      "",
      "Search results are discovery only. A channel is not authorized just because it appears in the results.",
    ],
    youtube: [
      "CONNECT YOUTUBE (ONE-TIME SETUP)",
      "",
      "1. Open https://console.cloud.google.com/ and create/select a Google Cloud project.",
      "2. In APIs & Services → Library, enable YouTube Data API v3.",
      "3. Configure the OAuth consent screen and add your Google account as a test user if Google requests it.",
      "4. In APIs & Services → Credentials, create an OAuth Client ID.",
      "5. Choose Desktop app, create it, and download the JSON file.",
      "6. Put that downloaded file in config/private/ and name it client_secrets.json.",
      "7. In Termux, run: node youtube-auth.mjs",
      "8. Open the Google authorization page, sign in, approve access, then return to Termux.",
      "9. The local token is saved in config/private/youtube-token.json. Keep both JSON files private.",
      "",
      "The uploader sends videos as PRIVATE. You choose Public or Schedule later in YouTube Studio.",
    ],
    chat: [
      "GET A CHAT REPLAY",
      "",
      "TWITCH:",
      "1. TwitchDownloaderCLI is already bundled in tools/TwitchDownloaderCLI-bin/.",
      "2. Preferred one-link workflow: TOP=3 ./make-clips.sh https://www.twitch.tv/videos/VOD_ID",
      "3. The helper runs the CLI through Debian PRoot because its binary needs glibc; the project and Node workflow stay in Termux.",
      "",
      "YOUTUBE:",
      "1. Install yt-dlp.",
      '2. Run: yt-dlp --skip-download --write-subs --sub-langs live_chat -o stream "VIDEO_URL"',
      "3. Select the generated live_chat JSONL file in Create.",
      "",
      "You need a chat replay that is available to download. Some streams do not have one.",
    ],
    captions: [
      "ADD SUBTITLES",
      "",
      "1. Create a vertical clip first.",
      "2. Install/build Whisper.cpp and download a multilingual model (for example, base).",
      "3. Make sure FFmpeg is installed.",
      "4. In Add Captions, choose your vertical MP4 and enter a title.",
      "5. The app transcribes Spanish speech, creates an SRT subtitle file, then burns the title and captions into a new video.",
      "6. Your final file ends in _final.mp4.",
      "",
      "On this Android setup, Whisper is bundled at tools/whisper.cpp/build/bin/whisper-cli and the model at tools/whisper.cpp/models/ggml-base.bin.",
    ],
    publish: [
      "UPLOAD AND PUBLISH",
      "",
      "1. Review the finished _final.mp4 and make sure you have reuse rights.",
      "2. Connect YouTube using the YouTube setup guide.",
      "3. In Share, select Upload a finished video here.",
      "4. Enter the title, description and tags, then confirm the upload.",
      "5. The app validates 1080×1920 and 1–180 seconds, then uploads as PRIVATE.",
      "6. Open YouTube Studio → Content → select the video.",
      "7. Review captions, title, description, audience and copyright checks.",
      "8. Change Visibility to Public or Schedule only when you're happy with the review.",
      "",
      "There is no automatic public publishing. The final visibility decision stays with you.",
    ],
  };
  note(guides[topic].join("\n"), "Step-by-step guide");
}

async function setupHelp() {
  const topic = await askSelect("What do you need help setting up?", [
    { value: "overview", label: "Full beginner guide: search → create → share" },
    { value: "twitch", label: "Connect Twitch API" },
    { value: "youtube", label: "Connect YouTube API / upload access" },
    { value: "chat", label: "Get a chat replay" },
    { value: "captions", label: "Install and use subtitles" },
    { value: "publish", label: "Upload and publish a video" },
  ]);
  await showGuide(topic);
}

function checkTools() {
  note(diagnose(ROOT, []).lines.join("\n"), "Installed tools");
}

async function main() {
  if (process.argv[2] === "doctor") {
    const report = diagnose(ROOT, process.argv.slice(3));
    console.log(report.lines.join("\n"));
    process.exitCode = report.code;
    return;
  }
  if (process.argv.length > 2) {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
      process.stdout.write("Interactive: stream-clip-maker\nDiagnostics: stream-clip-maker doctor [--render] [--youtube] [--twitch] [--captions]\nAdvanced: stream-clip-maker <chat-file> [options]\n\n");
      run(["--help"]);
      return;
    }
    const result = run(process.argv.slice(2));
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }

  intro(`${paint.magenta("◆")} ${paint.bold("STREAM CLIP MAKER")} ${paint.cyan("·")} ${paint.green("Your highlights, made simple")}`);
  note("Find great moments. Turn them into vertical clips. Add captions. Share when you're ready.\n\nNothing is uploaded or published without your confirmation.", "WELCOME");
  while (true) {
    const action = await askSelect("What would you like to do?", [
      { value: "search", label: "⌕  Search — Find live streams and VODs" },
      { value: "create", label: "✂  Create — Find moments and make clips" },
      { value: "captions", label: "字幕  Enhance — Add subtitles and a title" },
      { value: "share", label: "↑  Share — Upload a finished video" },
      { value: "help", label: "?  Setup & Help — Step-by-step guides" },
      { value: "tools", label: "⚙  Check — Make sure everything is ready" },
      { value: "exit", label: "✕  Exit" },
    ]);
    if (action === "exit") break;
    if (action === "search") await searchStreams();
    if (action === "create") await createClips();
    if (action === "captions") await addCaptions();
    if (action === "share") await shareVideo();
    if (action === "help") await setupHelp();
    if (action === "tools") await checkTools();
  }
  outro(`${paint.green("Thanks for creating with Stream Clip Maker!")}`);
}

main().catch((error) => {
  cancel(`Error: ${error.message}`);
  process.exitCode = 1;
});
