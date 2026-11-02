// Browser TimeRanges tracks actual played segments, excluding seek jumps.
// Merge ranges defensively so replaying a segment never inflates coverage.
export function watchedSeconds(ranges) {
  const intervals = [];
  for (let i = 0; i < ranges.length; i++) intervals.push([ranges.start(i), ranges.end(i)]);
  intervals.sort((a, b) => a[0] - b[0]);
  let seconds = 0, end = 0;
  for (const [start, stop] of intervals) {
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue;
    seconds += Math.max(0, stop - Math.max(end, start));
    end = Math.max(end, stop);
  }
  return Math.floor(seconds);
}
