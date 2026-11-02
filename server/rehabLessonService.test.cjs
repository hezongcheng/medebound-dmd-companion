const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLessonService } = require('./rehabLessonService');
const { buildCatalog, threshold, requiredSeconds } = require('./rehabLessonPolicy');
const { categories, lessons, applyRehabLessonSchema } = require('./rehabLessonSchema');

function video(id, category, version = '2.0', sort = id, required = 3) {
  return { id, title: `Video ${id}`, training_category: category, video_version: version,
    sort_order: sort, unlock_after_count: required, video_url: `https://example.test/${id}.mp4`, duration: 10, is_active: 1 };
}

test('five independent categories each open their first episode, with 2.0 ordered first', () => {
  const videos = categories.flatMap(([code], index) => [
    video(index * 10 + 1, code, '1.0', 1), video(index * 10 + 2, code, '2.0', 9)
  ]);
  const catalog = buildCatalog(videos);
  for (const [code] of categories) {
    const group = catalog.filter(row => row.training_category === code);
    assert.deepEqual(group.map(row => row.video_version), ['2.0', '1.0']);
    assert.deepEqual(group.map(row => row.is_unlocked), [true, false]);
  }
});

test('3, 4, and 5 complete viewings unlock only the next episode in the same category', () => {
  for (const required of [3, 4, 5]) {
    const videos = [video(1, 'lower_limb', '2.0', 1, required), video(2, 'lower_limb'), video(3, 'lower_limb'),
      video(4, 'trunk_control'), video(5, 'trunk_control')];
    const before = buildCatalog(videos, new Map([['1', required - 1]]));
    assert.equal(before.find(v => v.id === 2).is_unlocked, false);
    const after = buildCatalog(videos, new Map([['1', required]]));
    assert.equal(after.find(v => v.id === 2).is_unlocked, true);
    assert.equal(after.find(v => v.id === 3).is_unlocked, false);
    assert.equal(after.find(v => v.id === 4).is_unlocked, true);
    assert.equal(after.find(v => v.id === 5).is_unlocked, false);
  }
  assert.equal(threshold({ unlock_after_count: 0 }), 3);
  assert.equal(threshold({ unlock_after_count: 100 }), 3);
});

test('catalog mapping contains 18 known source videos, preserves filenames, and leaves missing upper videos absent', () => {
  assert.equal(lessons.length, 18);
  assert.equal(new Set(lessons.map(row => row[2])).size, 18);
  assert.equal(lessons.filter(row => row[0] === 'breathing_flexibility').length, 7);
  assert.equal(lessons.filter(row => row[0] === 'trunk_control').length, 4);
  assert.equal(lessons.filter(row => row[0] === 'lower_limb').length, 5);
  assert.equal(lessons.filter(row => row[0] === 'joint_mobility').length, 2);
  assert.equal(lessons.filter(row => row[0] === 'upper_limb').length, 0);
  assert.equal(lessons.find(row => row[1] === '蛙式开合训练')[2], 'v2/蚌式开合训练.mp4');
});

// Small transactional database double: exercise the actual service SQL boundaries,
// per-user serialization, rollbacks and writes rather than duplicating its policy.
function database() {
  let state = { sessions: [], checkins: [], details: [], nextId: 1 };
  let tail = Promise.resolve();
  const videos = [video(1, 'lower_limb'), video(2, 'lower_limb'), video(3, 'trunk_control')];
  const db = { elapsed: 100, failDetails: false, videos, read: () => structuredClone(state) };
  async function execute(sql, params = []) {
    if (sql.includes('FROM rehab_training_categories')) return [categories.map(([code, title]) => ({ code, title }))];
    if (sql.includes('SELECT * FROM rehab_videos')) return [videos.filter(v => v.is_active).map(v => ({ ...v }))];
    if (sql.includes('COUNT(*) AS completed_count')) {
      const counts = new Map();
      for (const session of state.sessions.filter(s => s.user_id === params[0] && s.status === 'completed')) {
        counts.set(session.video_id, (counts.get(session.video_id) || 0) + 1);
      }
      return [[...counts].map(([video_id, completed_count]) => ({ video_id, completed_count }))];
    }
    if (sql.includes('SELECT s.*')) {
      const session = state.sessions.find(s => s.id === params[0] && s.user_id === params[1]);
      if (!session) return [[]];
      const source = videos.find(v => v.id === session.video_id);
      return [[{ ...session, duration: source.duration, training_category: source.training_category,
        is_active: source.is_active, elapsed_seconds: db.elapsed }]];
    }
    if (sql.includes('INSERT INTO rehab_lesson_sessions')) {
      const id = state.nextId++;
      state.sessions.push({ id, user_id: params[0], video_id: params[1], status: 'started', started_at: new Date() });
      return [{ insertId: id }];
    }
    if (sql.includes("status = 'stopped'")) {
      const stoppingOne = sql.includes('WHERE id = ?');
      for (const session of state.sessions) {
        if (session.status === 'started' && (stoppingOne
          ? session.id === params[0] && session.user_id === params[1] : session.user_id === params[0])) session.status = 'stopped';
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("SET status = 'completed'")) {
      Object.assign(state.sessions.find(s => s.id === params[1]), { status: 'completed', watched_seconds: params[0] });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO rehab_checkins')) {
      const id = state.nextId++;
      state.checkins.push({ id, params });
      return [{ insertId: id }];
    }
    if (sql.includes('INSERT INTO rehab_checkin_details')) {
      if (db.failDetails) throw new Error('detail write failed');
      state.details.push(params);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  }
  db.execute = execute;
  db.getConnection = async () => {
    let snapshot, releaseLock;
    return {
      async beginTransaction() {},
      async execute(sql, params) {
        if (sql.includes('FROM users')) {
          const prior = tail;
          tail = new Promise(resolve => { releaseLock = resolve; });
          await prior;
          snapshot = structuredClone(state);
          return [[{ id: params[0] }]];
        }
        return execute(sql, params);
      },
      async commit() {},
      async rollback() { if (snapshot) state = snapshot; },
      release() { releaseLock?.(); }
    };
  };
  return db;
}

test('same-day repeated single-video sessions unlock the next lesson, without cross-category prerequisites', async () => {
  const db = database(), service = createLessonService(db);
  await assert.rejects(service.startLesson(7, 2), error => error.status === 403);
  assert.ok((await service.startLesson(7, 3)).sessionId);
  for (let i = 0; i < 3; i++) {
    const session = await service.startLesson(7, 1);
    await service.completeLesson(7, session.sessionId, 10);
  }
  const result = await service.getLessons(7);
  assert.equal(result.videos.find(v => v.id === 1).completed_count, 3);
  assert.equal(result.videos.find(v => v.id === 2).is_unlocked, true);
  assert.ok((await service.startLesson(7, 2)).sessionId);
  assert.equal(db.read().checkins.length, 3);
});

test('locked URLs are hidden and another user has separate progress', async () => {
  const db = database(), service = createLessonService(db);
  assert.equal((await service.getLessons(1)).videos.find(v => v.id === 2).video_url, null);
  const session = await service.startLesson(1, 1);
  await service.completeLesson(1, session.sessionId, 10);
  assert.equal((await service.getLessons(2)).videos.find(v => v.id === 1).completed_count, 0);
  await assert.rejects(service.completeLesson(2, session.sessionId, 10), error => error.status === 404);
});

test('45 seconds qualifies a long lesson, but 44 seconds of viewing or elapsed time does not', async () => {
  const db = database(), service = createLessonService(db);
  db.videos[0].duration = 200;
  const session = await service.startLesson(1, 1);
  assert.equal(session.video.required_watch_seconds, 45);
  await assert.rejects(service.completeLesson(1, session.sessionId, 44), error => error.status === 400);
  db.elapsed = 44;
  await assert.rejects(service.completeLesson(1, session.sessionId, 45), error => error.status === 400);
  db.elapsed = 45;
  await service.completeLesson(1, session.sessionId, 45);
  await service.completeLesson(1, session.sessionId, 45);
  const state = db.read();
  assert.equal(state.sessions[0].watched_seconds, 45);
  assert.equal(state.checkins.length, 1);
  assert.equal(state.checkins[0].params[4], 45);
  assert.equal(state.details[0][2], 45);
});

test('three qualified early exits unlock the next lesson and short videos retain their end tolerance', async () => {
  const db = database(), service = createLessonService(db);
  db.videos[0].duration = 200;
  for (let i = 0; i < 3; i++) {
    const session = await service.startLesson(1, 1);
    await service.completeLesson(1, session.sessionId, 45);
  }
  assert.equal((await service.getLessons(1)).videos.find(v => v.id === 2).is_unlocked, true);
  assert.equal(requiredSeconds({ duration: 45 }), 45);
  assert.equal(requiredSeconds({ duration: 200 }), 45);
  assert.equal(requiredSeconds({ duration: 30 }), 28);
  assert.equal(requiredSeconds({ duration: 1 }), 1);
});

test('paused/partial/early completion, invalid values, stopped and inactive sessions do not earn credit', async () => {
  const db = database(), service = createLessonService(db);
  const session = await service.startLesson(1, 1);
  await assert.rejects(service.completeLesson(1, session.sessionId, 3), error => error.status === 400);
  db.elapsed = 1;
  await assert.rejects(service.completeLesson(1, session.sessionId, 10), error => error.status === 400);
  await assert.rejects(service.completeLesson(1, session.sessionId, NaN), error => error.status === 400);
  await assert.rejects(service.startLesson(1, '-1'), error => error.status === 400);
  await service.stopLesson(1, session.sessionId);
  await assert.rejects(service.completeLesson(1, session.sessionId, 10), error => error.status === 409);
  const next = await service.startLesson(1, 1);
  db.videos[0].is_active = 0;
  await assert.rejects(service.completeLesson(1, next.sessionId, 10), error => error.status === 409);
  assert.equal(db.read().checkins.length, 0);
});

test('simultaneous and retried completion requests count a session only once', async () => {
  const db = database(), service = createLessonService(db);
  const session = await service.startLesson(1, 1);
  const results = await Promise.all([
    service.completeLesson(1, session.sessionId, 10), service.completeLesson(1, session.sessionId, 10)
  ]);
  assert.deepEqual(results.map(r => r.alreadyCompleted).sort(), [false, true]);
  assert.equal(db.read().checkins.length, 1);
  assert.equal(db.read().details.length, 1);
});

test('starting a new session stops the previous one and failed history writes roll back credit', async () => {
  const db = database(), service = createLessonService(db);
  const first = await service.startLesson(1, 1);
  const second = await service.startLesson(1, 3);
  await assert.rejects(service.completeLesson(1, first.sessionId, 10), error => error.status === 409);
  db.failDetails = true;
  await assert.rejects(service.completeLesson(1, second.sessionId, 10), /detail write failed/);
  assert.equal(db.read().sessions.find(s => s.id === second.sessionId).status, 'started');
  assert.equal(db.read().checkins.length, 0);
});

test('startup migration seeds only once and preserves later administrator edits', async () => {
  let migrated = false, writes = 0;
  const db = {
    async execute(sql) {
      if (sql.startsWith('SELECT id')) return [migrated ? [{ id: 1 }] : []];
      if (sql.startsWith('UPDATE rehab_videos')) writes++;
      if (sql.startsWith('INSERT INTO schema_migrations')) migrated = true;
      return [{}];
    },
    async beginTransaction() {}, async commit() {}, async rollback() {}
  };
  await applyRehabLessonSchema(db, async () => {});
  await applyRehabLessonSchema(db, async () => {});
  assert.equal(writes, 18);
});
