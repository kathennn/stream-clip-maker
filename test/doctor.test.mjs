import test from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../engine/doctor.mjs";

const missing = { find: () => undefined, run: () => null };
test("unavailable optional tools do not block analysis", () => {
  const report = diagnose(".", [], missing);
  assert.equal(report.code, 0);
  assert.match(report.lines.join("\n"), /Optional \| ffmpeg \| unavailable/);
});
test("a found executable must succeed for a selected workflow", () => {
  const calls = [];
  const report = diagnose(".", ["--render"], {
    find: name => name,
    run: (name, args) => {
      calls.push([name, args]);
      return name === "ffmpeg" ? null : "1.2.3";
    },
  });
  assert.equal(report.code, 1);
  assert.ok(calls.some(([name, [flag]]) => name === "ffmpeg" && flag === "-version"));
  assert.match(report.lines.join("\n"), /Required \| ffprobe \| 1\.2\.3/);
});
test("unsupported options do not run any probes", () => {
  const report = diagnose(".", ["--install"], { run: assert.fail });
  assert.equal(report.code, 2);
});
