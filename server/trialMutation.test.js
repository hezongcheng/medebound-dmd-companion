const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTrialMutation } = require('./trialMutation');

test('相同外显子起止编号合并为单个编号', () => {
  for (const separator of ['-', '/', ' / ', '–', '—', '－', '／']) {
    assert.equal(normalizeTrialMutation(`44${separator}44`), '44');
    assert.equal(normalizeTrialMutation(`外显子 44${separator}44 缺失`), '外显子 44 缺失');
    assert.equal(normalizeTrialMutation(`外显子 44${separator}44 重复`), '外显子 44 重复');
  }
  assert.equal(normalizeTrialMutation('exon 44-44 deletion'), 'exon 44 deletion');
});

test('不同编号范围、复杂变异及无效编号保留原文', () => {
  for (const text of ['44', '44-45', '外显子 44 / 45 缺失', '44-44-45', 'c.44-44del', 'c.44/44', '144-144', '0-0', '80-80', '不清楚', '']) {
    assert.equal(normalizeTrialMutation(text), text);
  }
  assert.equal(normalizeTrialMutation(undefined), '');
});
