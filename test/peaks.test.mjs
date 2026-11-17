import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreWindows, pickMoments, parseArgs, newWindow, addToWindow, scoreWindow } from "../chat-clips.mjs";
import { createPeakDetector, detectLive } from "../engine/peaks.mjs";
import { syntheticChat, SPIKES, POLL } from "./fixtures/synthetic-chat.mjs";

const expected = JSON.parse(readFileSync(new URL("./fixtures/expected-moments.json", import.meta.url), "utf8"));
const defaults = parseArgs([]).opts;
const msgs = syntheticChat();

test("batch scorer output is unchanged by the refactor", () => {
  const moments = pickMoments(scoreWindows(msgs, defaults), defaults);
  assert.deepEqual(moments, expected);
});

test("live windows score exactly like batch windows", () => {
  const batch = scoreWindows(msgs, defaults);
  const live = [];
  const d = createPeakDetector({ ...defaults, origin: batch.first }, { onWindow: (w) => live.push(w.score) });
  for (const m of msgs) d.push(m);
  d.flush();
  assert.deepEqual(live, batch.map((w) => w.score));
});

test("live detector finds the same peaks as batch on a steady chat", () => {
  const batch = expected.map((m) => [m.peak, m.start, m.end]);
  const origin = scoreWindows(msgs, defaults).first;
  const live = detectLive(msgs, { ...defaults, origin }).map((m) => [m.peak, m.start, m.end]);
  assert.deepEqual(live, batch);
});

test("each moment is reported only after its clip end has happened", () => {
  const live = detectLive(msgs, defaults);
  assert.equal(live.length, SPIKES.length + 1);
  for (const m of live) {
    assert.ok(m.detectedAt >= m.end, `detected at ${m.detectedAt} before clip end ${m.end}`);
    // ... and not much later: at most lead + tail + two windows after the peak
    assert.ok(m.detectedAt - m.peak <= defaults.lead + defaults.tail + 3 * defaults.window,
      `latency ${m.detectedAt - m.peak}s too high`);
  }
});

test("the copypasta poll is flagged as a vote", () => {
  const poll = detectLive(msgs, defaults).find((m) => Math.abs(m.peak - POLL) <= 10);
  assert.ok(poll, "poll window should still be reported");
  assert.equal(poll.vote, true);
});

test("background chatter alone never fires", () => {
  const quiet = syntheticChat({ seed: 3 }).filter((m) => m.user.startsWith("u"));
  assert.deepEqual(detectLive(quiet, defaults), []);
});

test("warm-up: nothing fires inside the first skip seconds", () => {
  const early = [];
  for (let t = 0; t < 400; t++) {
    early.push({ t, user: `u${t % 7}`, text: "hola" });
    if (t >= 60 && t < 70) for (let k = 0; k < 8; k++) early.push({ t, user: `r${k}${t}`, text: "JAJAJA" });
  }
  assert.deepEqual(detectLive(early, defaults), []);
});

test("tick closes windows during silence so a moment is not held forever", () => {
  const got = [];
  const d = createPeakDetector(defaults, { onMoment: (m) => got.push(m) });
  for (const m of msgs.filter((m) => m.t < SPIKES[0] + 15)) d.push(m);
  assert.equal(got.length, 0);
  d.tick(SPIKES[0] + 120); // chat goes silent, the clock keeps running
  assert.equal(got.length, 1);
});

test("shared window helpers match the batch scorer", () => {
  const w = newWindow(0, 0);
  addToWindow(w, { t: 1, user: "a", text: "JAJAJA" });
  addToWindow(w, { t: 2, user: "b", text: "hola" });
  scoreWindow(w, defaults);
  assert.equal(w.score, 2 * (1 + 2 * 0.5));
});

test("messages arriving after their window closed are dropped, not misbucketed", () => {
  const d = createPeakDetector({ ...defaults, origin: 0 });
  d.push({ t: 11, user: "current", text: "hello" });
  d.push({ t: 1, user: "late", text: "JAJAJA" });
  const state = d.snapshot();
  assert.equal(state.messages, 1);
  assert.equal(state.late, 1);
  assert.equal(state.lateDropped, 1);
});
