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

test('list exposes explicit multi-level tags and preserves untagged videos without legacy fallback', async () => {
  const service = loadService(async () => [[
    { id: 1, video_group: 'level1', video_groups_csv: 'level1,level3' },
    { id: 2, video_group: 'level2', video_groups_csv: null }
  ]]);
  const videos = JSON.parse(JSON.stringify(await service.getRehabVideos()));
  assert.deepEqual(videos.map(v => v.video_groups), [['level1', 'level3'], []]);
  assert.equal('video_groups_csv' in videos[0], false);
});

test('each level filter uses exact membership and parameterized status, without cumulative selection', async () => {
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
    assert.match(sql, /membership\.video_id = v\.id AND membership\.video_group = \?/);
    assert.doesNotMatch(sql, /(?:video_group\s*(?:<=|<)|video_group\s+IN)/i);
    assert.match(sql, /ORDER BY v\.sort_order ASC, v\.id ASC/);
  }
});

test('database edits appear on the next fetch rather than a cached tag result', async () => {
  let tags = 'level2';
  const service = loadService(async () => [[{ id: 1, video_groups_csv: tags }]]);
  assert.equal((await service.getRehabVideos())[0].video_groups.join(','), 'level2');
  tags = 'level1,level3';
  assert.equal((await service.getRehabVideos())[0].video_groups.join(','), 'level1,level3');
});

test('migration seeds exact legacy groups once and defines unique memberships with matching video ID type', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../database/20261026_rehab_video_levels.sql'), 'utf8');
  assert.match(sql, /video_id bigint NOT NULL/);
  assert.match(sql, /PRIMARY KEY \(video_id, video_group\)/);
  assert.match(sql, /SELECT id, video_group FROM rehab_videos/);
  assert.match(sql, /AND NOT EXISTS\s*\(\s*SELECT 1 FROM schema_migrations WHERE id = '20261026_rehab_video_levels_v1'/);
  assert.match(sql, /REFERENCES rehab_videos \(id\) ON DELETE CASCADE/);
});
