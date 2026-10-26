const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchTerms, appendKeywordGroupsToWhere } = require('./articleSearch');

test('增加通用修饰词不排除核心医学主题', () => {
  assert.deepEqual(searchTerms('外显子跳跃治疗'), ['外显子跳跃']);
  assert.deepEqual(searchTerms('外显子跳跃'), ['外显子跳跃']);
  assert.deepEqual(searchTerms('心肌病最新治疗'), ['心肌病']);
  assert.deepEqual(searchTerms('基因治疗 康复'), ['基因治疗', '康复']);
});
test('多词和别名使用 OR，外层保留日期及标签筛选', () => {
  const params = [];
  const sql = appendKeywordGroupsToWhere(' WHERE publication_date <= CURDATE()', params, [['外显子跳跃'], ['eteplirsen', 'Exondys']]);
  assert.equal((sql.match(/ AND /g) || []).length, 1);
  assert.equal(params.length, 21);
  assert.ok(params.includes('%Exondys%'));
  assert.ok(sql.includes("JSON_SEARCH(drug_names, 'one', ?)"));
  assert.ok(sql.endsWith('))'));
});
test('空白、标点、英文药名和通配符', () => {
  assert.deepEqual(searchTerms('  '), []);
  assert.deepEqual(searchTerms('，%%%'), []);
  assert.deepEqual(searchTerms('Ｅｔｅｐｌｉｒｓｅｎ'), ['eteplirsen']);
  const params = [];
  appendKeywordGroupsToWhere('', params, [['a_b%']]);
  assert.equal(params[0], '%a\\_b\\%%');
});
