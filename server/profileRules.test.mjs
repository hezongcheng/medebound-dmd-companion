import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ageFromBirthDate, businessToday, normalizeProfile, profileForAI } from './profileRules.mjs';

test('profile rules load independently without project-relative modules', async () => {
  const source = await readFile(new URL('./profileRules.mjs', import.meta.url), 'utf8');
  // A data URL has no parent directory, so any relative file import fails here.
  const standalone = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  for (const [value, expected] of [[undefined, 40], [75, 75], [0, 0], [100, 100], [-5, 0], [150, 100], [NaN, 40], ['80', 40]]) {
    assert.equal(standalone.normalizeProfile({ age: 12, contentPreference: value }).contentPreference, expected);
  }
});

test('completed years change on birthday, including newborn and year boundary', () => {
  assert.equal(ageFromBirthDate('2010-09-18', '2026-09-17'), 15);
  assert.equal(ageFromBirthDate('2010-09-18', '2026-09-18'), 16);
  assert.equal(ageFromBirthDate('2026-09-18', '2026-09-18'), 0);
  assert.equal(ageFromBirthDate('2010-12-31', '2026-01-01'), 15);
  assert.equal(businessToday(new Date('2026-09-17T16:00:00Z')), '2026-09-18');
});
test('leap-day policy and invalid dates', () => {
  assert.equal(ageFromBirthDate('2012-02-29', '2026-02-28'), 13);
  assert.equal(ageFromBirthDate('2012-02-29', '2026-03-01'), 14);
  for (const date of ['2011-02-29', '2026-04-31', '2026-13-01', '2026-09-19', '18/09/2010']) assert.equal(ageFromBirthDate(date, '2026-09-18'), null);
});
test('deletion and duplication share validated optional exon ranges', () => {
  for (const mutationType of ['deletion', 'duplication']) {
    const result = normalizeProfile({ age: 12, mutationType, exonStart: 45, exonEnd: 45 });
    assert.ok(result.geneticProfile.includes(mutationType === 'duplication' ? '重复' : '缺失'));
    assert.equal(result.exonStart, 45);
    assert.equal(normalizeProfile({ age: 12, mutationType }).exonStart, null);
    for (const [start, end] of [[0, 4], [1, 80], [50, 45], [1.5, 3], [1, undefined]]) assert.throws(() => normalizeProfile({ age: 12, mutationType, exonStart: start, exonEnd: end }));
  }
  assert.equal(normalizeProfile({ age: 12, mutationType: 'unsure', exonStart: 1, exonEnd: 2 }).exonStart, null);
});
test('legacy ages remain untouched, authoritative birth date replaces client age and stays out of AI payload', () => {
  const stored = { age: 12, birthday: '2010-09-18', mutation_type: 'duplication', exon_start: 45, exon_end: 50 };
  const profile = profileForAI({ age: 99, birthDate: '2000-01-01' }, stored, '2026-09-18');
  assert.equal(profile.age, 16); assert.ok(!Object.hasOwn(profile, 'birthDate'));
  assert.equal(profile.geneticProfile, '外显子 45-50 重复');
  assert.equal(profileForAI({}, { age: 12, birthday: null, genetic_profile: '历史基因描述' }).age, 12);
  assert.equal(profileForAI({}, { age: 12, birthday: null, genetic_profile: '历史基因描述' }).geneticProfile, '历史基因描述');
  assert.equal(normalizeProfile({ age: 12 }).birthDate, null);
});
