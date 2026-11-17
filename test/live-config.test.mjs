import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLiveArgs, assertAllowedChannels } from "../engine/live-config.mjs";

test("parses and deduplicates valid channel names", () => {
  const options = parseLiveArgs(["Channel_One", "channel_one", "--chat-only", "--max-disk-gb", "4"]);
  assert.deepEqual(options.channels, ["channel_one"]);
  assert.equal(options["chat-only"], true);
  assert.equal(options["max-disk-gb"], 4);
});

test("rejects unsafe channel names and unknown options", () => {
  assert.throws(() => parseLiveArgs(["../other"]), /channel names/);
  assert.throws(() => parseLiveArgs(["channel", "--unknown"]), /unknown option/);
});

test("validates numeric limits and stream quality", () => {
  assert.throws(() => parseLiveArgs(["channel", "--max-disk-gb", "0"]), /greater than zero/);
  assert.throws(() => parseLiveArgs(["channel", "--minutes", "-1"]), /cannot be negative/);
  assert.throws(() => parseLiveArgs(["channel", "--quality", "best;touch" ]), /--quality/);
});

test("blocks channels unless they are explicitly allowlisted", () => {
  assert.equal(assertAllowedChannels(["alice"], ["ALICE"]), true);
  assert.throws(() => assertAllowedChannels(["alice", "bob"], ["alice"]), /capture blocked for bob/);
  assert.throws(() => assertAllowedChannels(["alice"], undefined), /allowedCreators array/);
});

test("each argument parse receives an independent channel list", () => {
  const first = parseLiveArgs(["first_channel"]);
  const second = parseLiveArgs(["second_channel"]);
  assert.deepEqual(first.channels, ["first_channel"]);
  assert.deepEqual(second.channels, ["second_channel"]);
});
