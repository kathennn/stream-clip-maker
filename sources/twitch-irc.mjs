// Read-only Twitch chat over IRC, anonymous login (no account, no token).
//
// Anonymous `justinfan` logins are long-standing community practice, not a documented
// Twitch API: they may stop working one day. Only node:tls, so Node 18 keeps working.
//
//   for await (const m of twitchChat(["channel_a", "channel_b"])) { ... }
//   // m = { channel, ts (ms epoch, Twitch's own send time), user (stable id), name, text }

import { connect } from "node:tls";

const HOST = "irc.chat.twitch.tv";
const PORT = 6697;

// IRCv3 tag values escape ; space \ CR LF.
const unescapeTag = (v) => v.replace(/\\(.)/g, (_, c) => ({ ":": ";", s: " ", "\\": "\\", r: "\r", n: "\n" }[c] ?? c));

export function parseLine(line) {
  let rest = line;
  const tags = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    for (const kv of rest.slice(1, sp).split(";")) {
      const eq = kv.indexOf("=");
      tags[eq < 0 ? kv : kv.slice(0, eq)] = eq < 0 ? "" : unescapeTag(kv.slice(eq + 1));
    }
    rest = rest.slice(sp + 1);
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const trailingAt = rest.indexOf(" :");
  const head = trailingAt < 0 ? rest : rest.slice(0, trailingAt);
  const trailing = trailingAt < 0 ? undefined : rest.slice(trailingAt + 2);
  const [command, ...params] = head.split(" ").filter(Boolean);
  if (trailing !== undefined) params.push(trailing);
  return { tags, prefix, command, params };
}

export function toMessage(p, receivedAt = Date.now()) {
  if (p.command !== "PRIVMSG") return null;
  const channel = (p.params[0] || "").replace(/^#/, "");
  let text = p.params[1] ?? "";
  // /me actions arrive as CTCP ACTION
  const action = text.match(/^\u0001ACTION (.*)\u0001$/);
  if (action) text = action[1];
  const login = p.prefix.split("!")[0];
  const ts = Number(p.tags["tmi-sent-ts"]) || receivedAt;
  return { channel, ts, user: p.tags["user-id"] || login, name: p.tags["display-name"] || login, text };
}

// Async iterable of chat messages from one connection joined to every channel.
// Reconnects with backoff; `signal` (AbortSignal) ends it.
export async function* twitchChat(channels, { signal, onStatus = () => {} } = {}) {
  const queue = [];
  let wake = null;
  let stopped = false;
  let socket = null;
  let attempt = 0;
  const push = (item) => { queue.push(item); wake?.(); wake = null; };

  function open() {
    if (stopped) return;
    const nick = `justinfan${10000 + Math.floor(Math.random() * 80000)}`;
    socket = connect({ host: HOST, port: PORT, servername: HOST });
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("secureConnect", () => {
      socket.write("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
      socket.write(`NICK ${nick}\r\n`);
      for (const c of channels) socket.write(`JOIN #${c.toLowerCase()}\r\n`);
    });
    socket.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (!line) continue;
        const p = parseLine(line);
        if (p.command === "PING") { socket.write(`PONG :${p.params[0] ?? "tmi.twitch.tv"}\r\n`); continue; }
        if (p.command === "001") { attempt = 0; onStatus({ event: "connected", nick }); continue; }
        if (p.command === "JOIN") { onStatus({ event: "joined", channel: (p.params[0] || "").slice(1) }); continue; }
        if (p.command === "RECONNECT") { socket.destroy(); continue; }
        if (p.command === "NOTICE") { onStatus({ event: "notice", text: p.params[1] }); continue; }
        const m = toMessage(p);
        if (m) push(m);
      }
    });
    let retried = false; // 'error' is followed by 'close': retry once per socket
    const retry = (why) => {
      if (stopped || retried) return;
      retried = true;
      const wait = Math.min(30000, 1000 * 2 ** attempt++);
      onStatus({ event: "disconnected", why, retryInMs: wait });
      setTimeout(open, wait);
    };
    socket.on("error", (e) => retry(e.message));
    socket.on("close", () => retry("closed"));
  }

  signal?.addEventListener("abort", () => { stopped = true; socket?.destroy(); push(null); }, { once: true });
  open();
  try {
    while (true) {
      if (!queue.length) await new Promise((r) => { wake = r; });
      const item = queue.shift();
      if (item === null || stopped) return;
      yield item;
    }
  } finally {
    stopped = true;
    socket?.destroy();
  }
}
