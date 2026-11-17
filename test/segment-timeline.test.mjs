import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSegmentTimeline } from "../engine/segment-timeline.mjs";

const segments = [
  { file: "a.ts", wall: 100000, duration: 6 },
  { file: "b.ts", wall: 106000, duration: 6 },
  { file: "c.ts", wall: 124000, duration: 6 },
];

test("maps a clip across a wall-clock gap onto concatenated media time", () => {
  const result = buildSegmentTimeline(segments, 103000, 127000);
  assert.deepEqual(result.segments.map((s) => s.file), ["a.ts", "b.ts", "c.ts"]);
  assert.equal(result.startOffset, 3);
  assert.equal(result.duration, 12);
  assert.equal(result.gaps, 1);
  assert.equal(result.missingSeconds, 12);
});

test("starts at the next available segment when the requested start is in a gap", () => {
  const result = buildSegmentTimeline(segments, 115000, 127000);
  assert.deepEqual(result.segments.map((s) => s.file), ["c.ts"]);
  assert.equal(result.startOffset, 0);
  assert.equal(result.duration, 3);
});

test("ends at the last available frame when the requested end is in a gap", () => {
  const result = buildSegmentTimeline(segments, 103000, 110000);
  assert.deepEqual(result.segments.map((s) => s.file), ["a.ts", "b.ts"]);
  assert.equal(result.startOffset, 3);
  assert.equal(result.duration, 7);
});

test("returns an empty selection for a range fully inside a recording gap", () => {
  const result = buildSegmentTimeline(segments, 115000, 120000);
  assert.equal(result.segments.length, 0);
  assert.equal(result.duration, 0);
});

test("rejects invalid segment metadata and invalid ranges", () => {
  assert.throws(() => buildSegmentTimeline([{ file: "bad.ts", wall: 1, duration: 0 }], 0, 1), /positive duration/);
  assert.throws(() => buildSegmentTimeline([], 10, 10), /end after start/);
});
