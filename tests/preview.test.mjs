import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "chat-clips.mjs");

test("preview writes a selectable plan without starting download or render tools", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "stream-clip-preview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const input = join(dir, "chat.json");
  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const comments = [
    [0, "quiet"],
    [10, "peak"], [11, "peak"], [12, "peak"],
    [20, "quiet"], [30, "quiet"],
    [40, "peak"], [41, "peak"], [42, "peak"],
    [50, "quiet"],
  ].map(([content_offset_seconds, body], index) => ({
    content_offset_seconds,
    commenter: { name: `user-${index}` },
    message: { body },
  }));
  writeFileSync(input, JSON.stringify({ comments }));

  const env = {
    ...process.env,
    // The preview path must succeed even when no downloader or renderer is available.
    PATH: binDir,
  };
  const cases = [
    ["--vod", "123456"],
    ["--url", "https://example.test/video"],
    ["--video", "local-video.mp4"],
  ];

  for (const [index, source] of cases.entries()) {
    const out = join(dir, `out-${index}`);
    const result = spawnSync(process.execPath, [
      script, input, "--window", "10", "--skip", "0", "--lead", "0", "--tail", "0",
      "--baseline", "10", "--ratio", "0", "--min", "1", "--simple", "--vertical",
      "--preview", "--run", "--select", "2", "--out", out, ...source,
    ], { cwd: dir, env, encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Preview only: no downloads or rendering were started\./);
    const plan = JSON.parse(readFileSync(join(out, "moments.json"), "utf8"));
    assert.equal(plan.moments.length, 2);
    assert.deepEqual(plan.selected, [2]);
    assert.equal(plan.moments[0].duration, 10);
  }
});

test("--select limits rendering while --run without preview still runs all moments by default", { skip: process.platform === "win32" }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "stream-clip-select-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const input = join(dir, "chat.json");
  const binDir = join(dir, "bin");
  const marker = join(dir, "spawned.txt");
  mkdirSync(binDir);
  const comments = [
    [0, "quiet"], [10, "peak"], [11, "peak"], [12, "peak"],
    [20, "quiet"], [30, "quiet"], [40, "peak"], [41, "peak"], [42, "peak"], [50, "quiet"],
  ].map(([content_offset_seconds, body], index) => ({ content_offset_seconds, commenter: { name: `user-${index}` }, message: { body } }));
  writeFileSync(input, JSON.stringify({ comments }));
  for (const name of ["TwitchDownloaderCLI", "ffmpeg"]) {
    const executable = join(binDir, name);
    writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${name}' >> "$STREAM_CLIP_SPAWN_MARKER"\n`);
    chmodSync(executable, 0o755);
  }

  const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, STREAM_CLIP_SPAWN_MARKER: marker };
  const run = (out, extra) => spawnSync(process.execPath, [
    script, input, "--window", "10", "--skip", "0", "--lead", "0", "--tail", "0",
    "--baseline", "10", "--ratio", "0", "--min", "1", "--simple", "--vertical",
    "--vod", "123456", "--run", "--out", out, ...extra,
  ], { cwd: dir, env, encoding: "utf8" });

  const selected = run(join(dir, "selected"), ["--select", "2"]);
  assert.equal(selected.status, 0, selected.stderr);
  assert.deepEqual(readFileSync(marker, "utf8").trim().split(/\r?\n/), ["TwitchDownloaderCLI", "ffmpeg"]);

  rmSync(marker);
  const all = run(join(dir, "all"), []);
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(readFileSync(marker, "utf8").trim().split(/\r?\n/), [
    "TwitchDownloaderCLI", "ffmpeg", "TwitchDownloaderCLI", "ffmpeg",
  ]);
});
