// Map wall-clock capture times onto the concatenated media timeline.
// Segment gaps are omitted from the output, so offsets and duration must not use wall time directly.
export function buildSegmentTimeline(input, startWallMs, endWallMs) {
  if (!Number.isFinite(startWallMs) || !Number.isFinite(endWallMs) || endWallMs <= startWallMs) {
    throw new Error("segment range must have finite start and end times, with end after start");
  }
  if (!Array.isArray(input)) throw new Error("segments must be an array");

  const segments = input.map((segment) => {
    if (!segment || typeof segment.file !== "string" || !Number.isFinite(segment.wall) ||
        !Number.isFinite(segment.duration) || segment.duration <= 0) {
      throw new Error("each segment needs a file, a finite wall time and a positive duration");
    }
    return { ...segment };
  }).sort((a, b) => a.wall - b.wall);

  const selected = segments.filter((segment) =>
    segment.wall < endWallMs && segment.wall + segment.duration * 1000 > startWallMs);
  let elapsed = 0;
  const timelineSegments = selected.map((segment) => {
    const entry = { ...segment, timelineStart: elapsed, timelineEnd: elapsed + segment.duration };
    elapsed += segment.duration;
    return entry;
  });

  const mapTime = (wallMs) => {
    let offset = 0;
    for (const segment of timelineSegments) {
      const segmentEnd = segment.wall + segment.duration * 1000;
      if (wallMs < segment.wall) return offset;
      if (wallMs <= segmentEnd) {
        return offset + Math.max(0, Math.min(segment.duration, (wallMs - segment.wall) / 1000));
      }
      offset = segment.timelineEnd;
    }
    return offset;
  };

  const startOffset = mapTime(startWallMs);
  const endOffset = mapTime(endWallMs);
  const duration = Math.max(0, endOffset - startOffset);
  const gaps = timelineSegments.slice(1).filter((segment, index) =>
    segment.wall - (timelineSegments[index].wall + timelineSegments[index].duration * 1000) > 500).length;
  const requestedSeconds = (endWallMs - startWallMs) / 1000;

  return {
    segments: timelineSegments,
    startOffset,
    endOffset,
    duration,
    gaps,
    missingSeconds: Math.max(0, requestedSeconds - duration),
  };
}
