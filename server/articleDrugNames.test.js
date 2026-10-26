const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDrugNames } = require('./articleDrugNames');

const aliases = [
  { canonical_name: 'Agamree', alias_name: 'vamorolone' },
  { canonical_name: 'Agamree', alias_name: 'Agamree' },
  { canonical_name: 'Duvyzat', alias_name: 'givinostat' },
  { canonical_name: 'Prednisone', alias_name: 'prednisolone' },
  { canonical_name: 'Viltepso', alias_name: '外显子53跳跃药物' },
  { canonical_name: 'Vyondys 53', alias_name: '外显子53跳跃药物' }
];

test('canonicalizes evidenced names and rejects hallucinated medicines', () => {
  assert.deepEqual(normalizeDrugNames(['Agamree', 'givinostat', 'Elevidys'],
    'Vamorolone and givinostat were studied.', aliases), ['Agamree', 'Duvyzat']);
});

test('ambiguous or medically different aliases are not merged', () => {
  assert.deepEqual(normalizeDrugNames(['外显子53跳跃药物', 'prednisolone'],
    'The paper compares prednisolone with another treatment.', aliases), ['prednisolone']);
});

test('ambiguous category words are not stored even when the source mentions them', () => {
  assert.deepEqual(normalizeDrugNames(['外显子53跳跃药物'], '文中提到外显子53跳跃药物。', aliases), []);
});

test('generic categories and absent names are not stored as drugs', () => {
  assert.deepEqual(normalizeDrugNames(['steroid', 'Elevidys'], 'A steroid was used.', aliases), []);
});
