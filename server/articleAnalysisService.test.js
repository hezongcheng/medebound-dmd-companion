const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createArticleAnalysisService } = require('./articleAnalysisService');
const { buildArticlePublicPrompt, buildArticlePersonalPrompt } = require('./articlePrompt');

function fakeDatabase() {
  const publicRows = new Map();
  const personalRows = new Map();
  return {
    async execute(sql, params) {
      if (sql.includes('FROM articles_cache')) return [[{ id: params[0], title: '论文标题', abstract: '论文摘要' }]];
      if (sql.includes('FROM article_public_analysis_cache')) return [[publicRows.get(params.join(':'))].filter(Boolean)];
      if (sql.includes('FROM article_personal_analysis_cache')) return [[personalRows.get(params.join(':'))].filter(Boolean)];
      if (sql.includes('INSERT IGNORE INTO article_public_analysis_cache')) {
        const key = params.slice(0, 2).join(':');
        if (!publicRows.has(key)) publicRows.set(key, { quickConclusion: params[2], detailedReading: params[3] });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT IGNORE INTO article_personal_analysis_cache')) {
        const key = params.slice(0, 4).join(':');
        if (!personalRows.has(key)) personalRows.set(key, { personalizedMeaning: params[4], familyTakeaway: params[5] });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test('同一文献的前两部分固定，后两部分按用户和档案分别缓存', async () => {
  let publicCalls = 0;
  let personalCalls = 0;
  const service = createArticleAnalysisService(fakeDatabase(), {
    public: async () => ({ quickConclusion: `公共结论${++publicCalls}`, detailedReading: '公共详解' }),
    personal: async (_article, profile) => ({ personalizedMeaning: `用户解读${++personalCalls}，${profile.age}岁`, familyTakeaway: '家庭启示' })
  });
  const first = await service.analyze('123', { age: 8 }, 1);
  const repeated = await service.analyze('123', { age: 8 }, 1);
  const anotherUser = await service.analyze('123', { age: 8 }, 2);
  const changedProfile = await service.analyze('123', { age: 9 }, 1);
  assert.equal(publicCalls, 1);
  assert.equal(personalCalls, 3);
  assert.equal(repeated.cached, true);
  assert.equal(anotherUser.publicCached, true);
  assert.equal(anotherUser.personalCached, false);
  assert.ok(first.text.includes('公共结论1'));
  assert.ok(anotherUser.text.includes('公共结论1'));
  assert.ok(changedProfile.text.includes('公共结论1'));
  assert.notEqual(first.text, anotherUser.text);
  assert.ok(changedProfile.text.includes('9岁'));
});

test('并发首次打开同一文献只生成一次公共部分', async () => {
  let publicCalls = 0;
  const service = createArticleAnalysisService(fakeDatabase(), {
    public: async () => { publicCalls++; await new Promise(resolve => setTimeout(resolve, 5));
      return { quickConclusion: '共同结论', detailedReading: '共同详解' }; },
    personal: async () => ({ personalizedMeaning: '个性化', familyTakeaway: '启示' })
  });
  const results = await Promise.all([
    service.analyze('123', { age: 8 }, 1), service.analyze('123', { age: 9 }, 2)
  ]);
  assert.equal(publicCalls, 1);
  assert.ok(results.every(result => result.text.includes('共同结论')));
});

test('不同服务实例竞争首次生成时以数据库先保存的公共文本为准', async () => {
  const database = fakeDatabase();
  const makeService = conclusion => createArticleAnalysisService(database, {
    public: async () => ({ quickConclusion: conclusion, detailedReading: '共同详解' }),
    personal: async () => ({ personalizedMeaning: '个人解读', familyTakeaway: '家庭启示' })
  });
  const [first, second] = await Promise.all([
    makeService('版本A').analyze('123', { age: 8 }, 1),
    makeService('版本B').analyze('123', { age: 9 }, 2)
  ]);
  assert.equal(first.text.match(/版本[AB]/)?.[0], second.text.match(/版本[AB]/)?.[0]);
});

test('公共提示词不包含患者档案，个人提示词只要求后两部分', () => {
  const article = { title: '标题', abstract: '摘要' };
  const publicPrompt = buildArticlePublicPrompt(article);
  const personalPrompt = buildArticlePersonalPrompt(article, { age: 12, geneticProfile: '外显子缺失' },
    { quickConclusion: '结论', detailedReading: '详解' });
  assert.ok(!publicPrompt.includes('12岁'));
  assert.ok(!publicPrompt.includes('外显子缺失'));
  assert.ok(personalPrompt.includes('12岁'));
  assert.ok(personalPrompt.includes('personalizedMeaning'));
  assert.ok(personalPrompt.includes('不得重写或重复第1、2部分'));
});
