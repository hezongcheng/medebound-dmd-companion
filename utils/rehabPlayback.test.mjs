import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchedSeconds } from './rehabPlayback.mjs';
const ranges = entries => ({ length: entries.length, start: i => entries[i][0], end: i => entries[i][1] });

test('full video and paused/resumed playback count actual unique seconds', () => {
  assert.equal(watchedSeconds(ranges([[0, 94.5]])), 94);
  assert.equal(watchedSeconds(ranges([[0, 30], [30, 94.5]])), 94);
  assert.equal(watchedSeconds(ranges([])), 0);
});
test('skipping to the end and replaying the same segment do not inflate watch coverage', () => {
  assert.equal(watchedSeconds(ranges([[0, 2], [90, 94.5]])), 6);
  assert.equal(watchedSeconds(ranges([[0, 30], [10, 30], [20, 35]])), 35);
  assert.equal(watchedSeconds(ranges([[50, 60], [0, 10]])), 20);
});
