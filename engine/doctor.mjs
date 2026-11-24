import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

function executable(name) {
  const file = process.platform === "win32" ? name + ".exe" : name;
  for (const dir of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    const path = resolve(dir, file);
    try {
      accessSync(path, constants.X_OK);
      if (statSync(path).isFile()) return path;
    } catch { /* try the next PATH entry */ }
  }
}

function probe(file, args) {
  if (!file) return null;
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 5000, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  // Only report the version number, never arbitrary command output.
  const version = /\b\d+(?:\.\d+){1,3}\b/.exec(result.stdout + result.stderr);
  return version?.[0] ?? "available";
}

export function diagnose(root, flags, { find = executable, run = probe } = {}) {
  const supported = ["--render", "--youtube", "--twitch", "--captions"];
  if (flags.some(flag => !supported.includes(flag))) {
    return { lines: ["Usage: stream-clip-maker doctor [--render] [--youtube] [--twitch] [--captions]"], code: 2 };
  }
  const lines = [];
  let code = 0;
  const row = (name, required, result, hint) => {
    if (required && !result) code = 1;
    lines.push((required ? "Required" : "Optional") + " | " + name + " | " + (result || "unavailable: " + hint));
  };
  const check = (name, required, file, args, hint) => {
    const version = run(file, args);
    row(name, required, version && (version + " (" + file + ")"), hint);
  };

  row("Node.js", true, Number(process.versions.node.split(".")[0]) >= 18 && process.version + " (" + process.execPath + ")", "install Node.js 18 or newer");
  // npm.cmd is not directly executable by spawnSync on Windows.
  if (process.platform === "win32") {
    check("npm", false, process.execPath,
      [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), "--version"],
      "install npm with Node.js to manage packages");
  } else {
    check("npm", false, find("npm"), ["--version"], "install npm with Node.js to manage packages");
  }
  for (const tool of ["ffmpeg", "ffprobe"]) {
    check(tool, flags.length > 0, find(tool), ["-version"], "add the FFmpeg binaries for your OS to PATH");
  }
  check("yt-dlp", flags.includes("--youtube"), find("yt-dlp"), ["--version"], "install the yt-dlp binary for your OS");
  const twitch = find("TwitchDownloaderCLI");
  const bundled = join(root, "tools", "TwitchDownloaderCLI-bin", "TwitchDownloaderCLI");
  const isTermux = process.platform === "android" || /\/com\.termux\//.test(process.env.PREFIX || "");
  if (isTermux) {
    check("TwitchDownloaderCLI (Debian PRoot)", flags.includes("--twitch"), find("proot-distro"),
      ["login", "debian", "--", bundled, "--version"], "install Debian PRoot and the bundled Linux TwitchDownloaderCLI");
  } else {
    check("TwitchDownloaderCLI", flags.includes("--twitch"), twitch, ["--version"], "install the native TwitchDownloaderCLI release on PATH");
  }
  const whisperRoot = join(root, "tools", "whisper.cpp");
  const whisper = join(whisperRoot, "build", "bin", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
  check("Whisper.cpp", flags.includes("--captions"), whisper, ["--help"], "build whisper-cli under tools/whisper.cpp");
  const model = process.env.WHISPER_MODEL || join(whisperRoot, "models", "ggml-base.bin");
  let readable = false;
  try {
    accessSync(model, constants.R_OK);
    const info = statSync(model);
    readable = info.isFile() && info.size > 0;
  } catch { /* unavailable model */ }
  row("Whisper model", flags.includes("--captions"), readable && "readable, non-empty file", "set WHISPER_MODEL to a readable model file");
  return { lines, code };
}
