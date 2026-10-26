import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_TYPES, classifyContent, normalizeContentPreference, recommendArticles } from '../utils/contentPreference.mjs';
import { normalizeProfile } from './profileRules.mjs';

const pool = CONTENT_TYPES.flatMap(type => Array.from({ length: 150 }, (_, i) => ({
  id: `${type.key}-${i}`, researchStage: type.label,
  publicationDate: new Date(Date.UTC(2026, 9, 15 - i)).toISOString(), tags: []
})));
const basicCount = articles => articles.filter(a => ['animal', 'vitro'].includes(classifyContent(a))).length;

test('七类位置固定，研究阶段优先于宽泛标签，未知研究保持中性', () => {
  assert.deepEqual(CONTENT_TYPES.map(t => t.position), [10, 20, 30, 40, 55, 75, 90]);
  for (const type of CONTENT_TYPES) assert.equal(classifyContent({ researchStage: type.label, tags: ['综述', '临床试验'] }), type.key);
  assert.equal(classifyContent({ tags: ['研究论文'] }), 'unknown');
  assert.equal(classifyContent({ tags: ['clinical_trial'] }), 'clinical');
});

test('临床端前20篇以4:1穿插，向下浏览逐渐增加前临床内容', () => {
  const result = recommendArticles(pool, 0);
  assert.equal(basicCount(result.slice(0, 20)), 4);
  for (let i = 0; i < 20; i += 5) assert.equal(basicCount(result.slice(i, i + 5)), 1);
  assert.ok(basicCount(result.slice(80, 100)) > 4);
  assert.equal(new Set(result.map(a => a.id)).size, pool.length);
});

test('右移增加前沿曝光，每类内部保持新到旧，分页前缀稳定', () => {
  const left = recommendArticles(pool, 0);
  const middle = recommendArticles(pool);
  const right = recommendArticles(pool, 100);
  assert.ok(basicCount(left.slice(0, 20)) < basicCount(middle.slice(0, 20)));
  assert.ok(basicCount(middle.slice(0, 20)) < basicCount(right.slice(0, 20)));
  for (const type of CONTENT_TYPES) {
    const dates = right.filter(a => classifyContent(a) === type.key).map(a => a.publicationDate);
    assert.deepEqual(dates, [...dates].sort().reverse());
  }
  assert.deepEqual(right.slice(0, 20), recommendArticles([...pool].reverse(), 100).slice(0, 20));
});

test('稀缺类别自动补位，不丢失文章或重复，空池安全', () => {
  const animals = pool.filter(a => a.researchStage === '动物实验').slice(0, 25);
  const result = recommendArticles([...animals, animals[0]], 0);
  assert.equal(result.length, 25);
  assert.deepEqual(recommendArticles([], 40), []);
  assert.equal(recommendArticles([{ id: 'untagged' }])[0].id, 'untagged');
});

test('旧用户默认40，边界与异常输入归一化，保存档案携带偏好', () => {
  for (const value of [undefined, null, NaN, '80']) assert.equal(normalizeContentPreference(value), 40);
  assert.equal(normalizeContentPreference(-5), 0);
  assert.equal(normalizeContentPreference(150), 100);
  assert.equal(normalizeProfile({ age: 12, contentPreference: 75 }).contentPreference, 75);
  assert.equal(normalizeProfile({ age: 12 }).contentPreference, 40);
});
