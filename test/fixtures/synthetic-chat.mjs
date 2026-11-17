// Deterministic synthetic chat for tests: one hour of background chatter with
// three real reaction spikes and one copypasta poll. No randomness from the clock.

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const CHATTER = ["hola", "que tal", "buenas", "esta bueno el juego", "donde esta eso", "jugamos luego?",
  "nice", "gg", "el mapa es enorme", "saludos desde mexico", "que hora es", "first time here"];
const LAUGHS = ["JAJAJAJA", "jajaja", "KEKW", "LMAO", "💀💀💀", "NOOOO", "clip it", "XDDD", "omggg", "🤣🤣"];

export const SPIKES = [900, 1800, 3000];
export const POLL = 2400;

export function syntheticChat({ seed = 7, duration = 3600 } = {}) {
  const rnd = lcg(seed);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const msgs = [];
  for (let t = 0; t < duration; t += 1) {
    // ~0.6 messages per second of background chatter from 300 regulars
    if (rnd() < 0.6) msgs.push({ t: t + rnd(), user: `u${Math.floor(rnd() * 300)}`, text: pick(CHATTER) });
    for (const s of SPIKES) {
      if (t >= s && t < s + 12) {
        for (let k = 0; k < 6; k++) msgs.push({ t: t + rnd(), user: `r${Math.floor(rnd() * 400)}`, text: pick(LAUGHS) });
      }
    }
    if (t >= POLL && t < POLL + 10) {
      for (let k = 0; k < 6; k++) msgs.push({ t: t + rnd(), user: `v${Math.floor(rnd() * 400)}`, text: "100" });
    }
  }
  return msgs.sort((a, b) => a.t - b.t);
}

// TwitchDownloader-shaped JSON, so the CLI can read it like a real chat file.
export function asTwitchJson(msgs) {
  return {
    comments: msgs.map((m) => ({
      content_offset_seconds: m.t,
      commenter: { _id: m.user, name: m.user },
      message: { body: m.text },
    })),
  };
}
