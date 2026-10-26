const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadService(execute) {
  const context = {
    require(name) {
      assert.equal(name, './db');
      return { pool: { execute } };
    },
    module: { exports: {} },
    Intl, Date
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'rehabService.js'), 'utf8'), context);
  return context.module.exports;
}

test('videos in the same training group retain independent database versions, including unset versions', async () => {
  const service = loadService(async () => [[
    { id: 1, video_group: 'level1', video_version: '3.0' },
    { id: 2, video_group: 'level1', video_version: '1.0' },
    { id: 3, video_group: 'level3', video_version: '2.0' },
    { id: 4, video_group: 'level2', video_version: null }
  ]]);
  const videos = JSON.parse(JSON.stringify(await service.getRehabVideos()));
  assert.deepEqual(videos.map(v => v.video_version), ['3.0', '1.0', '2.0', null]);
});

test('training group filter remains exact and independent of video version', async () => {
  const calls = [];
  const service = loadService(async (sql, params) => {
    calls.push({ sql, params: Array.from(params) });
    return [[]];
  });
  for (const group of ['level1', 'level2', 'level3']) {
    await service.getRehabVideos('ambulatory', group);
    const { sql, params } = calls.at(-1);
    assert.deepEqual(params, ['ambulatory', group]);
    assert.match(sql, /v\.is_active = 1/);
    assert.match(sql, /v\.target_status = \? OR v\.target_status = "all"/);
    assert.match(sql, /AND v\.video_group = \?/);
    assert.doesNotMatch(sql, /rehab_video_levels|video_version\s*=/);
    assert.doesNotMatch(sql, /(?:video_group\s*(?:<=|<)|video_group\s+IN)/i);
    assert.match(sql, /ORDER BY v\.sort_order ASC, v\.id ASC/);
  }
});

test('database version edits appear on the next fetch', async () => {
  let version = '2.0';
  const service = loadService(async () => [[{ id: 1, video_group: 'level1', video_version: version }]]);
  assert.equal((await service.getRehabVideos())[0].video_version, '2.0');
  version = '3.0';
  assert.equal((await service.getRehabVideos())[0].video_version, '3.0');
});

test('migration adds a separate nullable version field without inferring historical versions', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../database/20261026_rehab_video_version.sql'), 'utf8');
  assert.match(sql, /video_version VARCHAR\(20\) NULL DEFAULT NULL/);
  assert.match(sql, /information_schema.columns/);
  assert.doesNotMatch(sql, /UPDATE rehab_videos|INSERT INTO rehab_video_levels/);
});
