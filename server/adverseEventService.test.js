const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdverseEventService } = require('./adverseEventService');

test('looks up a named drug, returns reported terms, and reuses the result', async () => {
  const calls = [];
  const service = createAdverseEventService({ async get(url, options) {
    calls.push({ url, options });
    return { data: { meta: { results: { total: 12 }, last_updated: '2026-07-01' }, results: [{ term: 'HEADACHE', count: 4 }] } };
  } });
  const [first, second] = await Promise.all([service.getDrugEvents('Elevidys'), service.getDrugEvents('Elevidys')]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.params.search, 'patient.drug.openfda.brand_name:"Elevidys"');
  assert.equal(first.status, 'available');
  assert.equal(first.total, 12);
  assert.equal(first.dataUpdatedAt, '2026-07-01');
  assert.deepEqual(first.reactions, [{ term: 'HEADACHE', count: 4 }]);
  assert.deepEqual(first, second);
});

test('separates no matching reports from an unavailable upstream', async () => {
  const noReports = createAdverseEventService({ async get() { const error = new Error('not found'); error.response = { status: 404 }; throw error; } });
  const unavailable = createAdverseEventService({ async get() { throw new Error('timeout'); } });
  assert.equal((await noReports.getDrugEvents('Test Drug')).status, 'no_reports');
  assert.equal((await unavailable.getDrugEvents('Test Drug')).status, 'unavailable');
  assert.equal((await unavailable.getDrugEvents('bad"name')).status, 'invalid');
});

test('checks generic name if a trial intervention has no brand-name reports', async () => {
  const calls = [];
  const service = createAdverseEventService({ async get(_url, options) {
    calls.push(options.params.search);
    if (calls.length === 1) { const error = new Error('not found'); error.response = { status: 404 }; throw error; }
    return { data: { meta: { results: { total: 3 } }, results: [{ term: 'FATIGUE', count: 2 }] } };
  } });
  const result = await service.getDrugEvents('Test Generic');
  assert.equal(result.status, 'available');
  assert.equal(result.matchedBy, 'generic_name');
  assert.match(calls[1], /generic_name/);
});
