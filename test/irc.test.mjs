import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, toMessage } from "../sources/twitch-irc.mjs";

test("parses IRCv3 tags, prefix, command, channel and trailing message", () => {
  const parsed = parseLine("@badge-info=;display-name=Alice\\sSmith;user-id=42;tmi-sent-ts=1700000000123 :alice!alice@alice.tmi.twitch.tv PRIVMSG #somechannel :hello world");
  assert.equal(parsed.command, "PRIVMSG");
  assert.equal(parsed.params[0], "#somechannel");
  assert.equal(parsed.params[1], "hello world");
  assert.equal(parsed.tags["display-name"], "Alice Smith");
  assert.equal(parsed.tags["user-id"], "42");
});

test("converts a tagged PRIVMSG using Twitch message timestamp and stable user id", () => {
  const parsed = parseLine("@display-name=Alice;user-id=42;tmi-sent-ts=1700000000123 :alice!alice@host PRIVMSG #channel :KEKW");
  assert.deepEqual(toMessage(parsed), {
    channel: "channel", ts: 1700000000123, user: "42", name: "Alice", text: "KEKW",
  });
});

test("falls back to login and receive time when optional tags are absent", () => {
  const parsed = parseLine(":alice!alice@host PRIVMSG #channel :hello");
  assert.deepEqual(toMessage(parsed, 1234), {
    channel: "channel", ts: 1234, user: "alice", name: "alice", text: "hello",
  });
});

test("unwraps CTCP ACTION messages", () => {
  const parsed = parseLine(":alice!alice@host PRIVMSG #channel :\u0001ACTION waves\u0001");
  assert.equal(toMessage(parsed).text, "waves");
});

test("does not treat PING and server notices as chat messages", () => {
  assert.equal(toMessage(parseLine("PING :tmi.twitch.tv")), null);
  assert.equal(toMessage(parseLine(":tmi.twitch.tv NOTICE #channel :Login authentication failed")), null);
});

test("parses IRCv3 escaped tag values", () => {
  const parsed = parseLine("@x=semi\\:colon\\sword\\r\\nslash\\\\value :a!a@h PRIVMSG #c :ok");
  assert.equal(parsed.tags.x, "semi;colon word\r\nslash\\value");
});
