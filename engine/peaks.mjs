// Live peak detector: the same window scoring as chat-clips.mjs, fed one message at a time.
// No I/O. One instance per channel. Times are seconds on the recording's clock.
//
//   const d = createPeakDetector(opts, { onMoment: (m) => cut(m) });
//   d.push({ t, user, text });   // messages in (roughly) time order
//   d.tick(t);                   // call every few seconds so silence also closes windows
//   d.flush();                   // stream ended: emit the moment still open
//
// Differences from the batch scorer, all forced by not knowing the future:
// - The floor is the median of the windows seen so far (batch uses the whole stream).
//   `skip` doubles as warm-up, so the first minutes cannot fire.
// - A window is a peak once the next window has closed: one window of extra delay.
// - A moment is emitted when no later peak can join it (lead + tail seconds after its
//   last peak), so its clip end is already in the recording when it is reported.
// - There is no top-N: every moment that clears the thresholds is reported.

import { newWindow, addToWindow, scoreWindow, median, momentOf } from "../chat-clips.mjs";

export const LIVE_DEFAULTS = { window: 10, lead: 20, tail: 15, max: 90, skip: 180, baseline: 300, ratio: 2.5, min: 5 };

export function createPeakDetector(options = {}, { onWindow, onMoment } = {}) {
  const o = { ...LIVE_DEFAULTS, ...options };
  const origin = o.origin ?? 0;
  const back = Math.max(1, Math.round(o.baseline / o.window));
  const recent = []; // last `back` closed scores, oldest first
  const seen = []; // every closed score, for the running floor
  let cur = null; // open window
  let prev = null; // last closed window, waiting for its right neighbour
  let prev2 = null; // the closed window before it
  let group = null; // open moment
  const moments = [];
  let stats = { messages: 0, windows: 0, late: 0 };

  const indexAt = (t) => Math.floor((t - origin) / o.window);

  function emit() {
    if (!group) return;
    const m = { ...momentOf(group, o), detectedAt: group.closedAt };
    moments.push(m);
    group = null;
    onMoment?.(m);
  }

  function consider(w, left, right) {
    const isPeak = w.start >= origin + o.skip &&
      w.ratio >= o.ratio &&
      (o.simple ? w.score >= o.min : w.people.size >= o.min) &&
      w.score >= (left?.score ?? 0) &&
      w.score >= (right?.score ?? 0);
    if (!isPeak) return;
    const fits = group && w.start - group.last.start <= o.lead + o.tail &&
      w.start + o.window + o.tail - group.start <= o.max;
    if (fits) {
      group.last = w;
      if (w.excess > group.best.excess) group.best = w;
    } else {
      emit();
      group = { start: Math.max(0, w.start - o.lead), last: w, best: w };
    }
  }

  function close(w) {
    scoreWindow(w, o);
    seen.push(w.score);
    const floor = Math.max(1, median(seen));
    w.base = Math.max(floor, recent.length >= back / 2 ? median(recent) : floor);
    w.ratio = w.score / w.base;
    w.excess = w.score - w.base;
    recent.push(w.score);
    if (recent.length > back) recent.shift();
    stats.windows++;
    onWindow?.(w);
    if (prev) consider(prev, prev2, w);
    prev2 = prev;
    prev = w;
    const now = w.start + o.window;
    // No later peak can join the open moment any more: report it.
    if (group && now - o.window > group.last.start + o.lead + o.tail) {
      group.closedAt = now;
      emit();
    }
    // Free the heavy per-window sets once a window can no longer be a peak or a neighbour.
    if (prev2 && prev2 !== group?.best && prev2 !== group?.last) {
      prev2.people = { size: prev2.people.size };
      prev2.reactors = { size: prev2.reactors.size };
      prev2.words = null;
    }
  }

  function advanceTo(index) {
    if (!cur) cur = newWindow(Math.max(0, index), origin + Math.max(0, index) * o.window);
    while (cur.i < index) {
      const next = cur.i + 1;
      close(cur);
      cur = newWindow(next, origin + next * o.window);
    }
  }

  return {
    options: o,
    moments,
    push(msg) {
      if (!Number.isFinite(msg.t) || msg.t < origin) return;
      const i = indexAt(msg.t);
      if (cur && i < cur.i) { stats.late++; addToWindow(cur, msg); stats.messages++; return; }
      advanceTo(i);
      addToWindow(cur, msg);
      stats.messages++;
    },
    tick(t) {
      if (Number.isFinite(t) && t >= origin) advanceTo(indexAt(t));
    },
    flush() {
      if (cur) { close(cur); cur = null; }
      if (prev) consider(prev, prev2, null);
      if (group) { group.closedAt = prev ? prev.start + o.window : origin; emit(); }
      return moments;
    },
    snapshot() {
      return {
        ...stats,
        moments: moments.length,
        openMoment: Boolean(group),
        lastScore: prev ? +prev.score.toFixed(1) : null,
        lastBaseline: prev ? +prev.base.toFixed(1) : null,
      };
    },
  };
}

// Feed a whole chat through the live detector (what a live run would have reported).
export function detectLive(msgs, options = {}) {
  const d = createPeakDetector(options);
  for (const m of [...msgs].sort((a, b) => a.t - b.t)) d.push(m);
  return d.flush();
}
