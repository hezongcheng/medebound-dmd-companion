const { buildCatalog, lessonError, positiveId, requiredSeconds } = require('./rehabLessonPolicy');

function createLessonService(pool) {
  async function catalog(db, userId) {
    const [videos] = await db.execute(
      'SELECT * FROM rehab_videos WHERE is_active = 1 AND training_category IS NOT NULL'
    );
    const [progress] = await db.execute(
      `SELECT video_id, COUNT(*) AS completed_count FROM rehab_lesson_sessions
       WHERE user_id = ? AND status = 'completed' GROUP BY video_id`, [userId]
    );
    return buildCatalog(videos, new Map(progress.map(row => [String(row.video_id), row.completed_count])));
  }

  async function getLessons(userId) {
    const [categories] = await pool.execute('SELECT * FROM rehab_training_categories ORDER BY sort_order, code');
    const videos = await catalog(pool, userId);
    return {
      categories,
      videos: videos.map(video => ({ ...video, video_url: video.is_unlocked ? video.video_url : null }))
    };
  }

  async function withUserLock(userId, work) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // 同一用户多个标签页、设备并发时串行修改，只保留一个进行中的学习记录。
      const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (!users.length) throw lessonError('用户不存在', 404);
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function startLesson(userId, rawVideoId) {
    const videoId = positiveId(rawVideoId);
    return withUserLock(userId, async db => {
      const lesson = (await catalog(db, userId)).find(video => Number(video.id) === videoId);
      if (!lesson) throw lessonError('视频不存在或尚未上线', 404);
      if (!lesson.is_unlocked) throw lessonError('请先完成上一集的累计学习次数', 403);
      await db.execute(
        "UPDATE rehab_lesson_sessions SET status = 'stopped', ended_at = NOW() WHERE user_id = ? AND status = 'started'", [userId]
      );
      const [result] = await db.execute(
        'INSERT INTO rehab_lesson_sessions (user_id, video_id) VALUES (?, ?)', [userId, videoId]
      );
      return { sessionId: result.insertId, video: lesson };
    });
  }

  async function completeLesson(userId, rawSessionId, watchedSeconds) {
    const sessionId = positiveId(rawSessionId);
    if (typeof watchedSeconds !== 'number' || !Number.isFinite(watchedSeconds) || watchedSeconds < 0) {
      throw lessonError('无效的学习时长');
    }
    return withUserLock(userId, async db => {
      const [sessions] = await db.execute(
        `SELECT s.*, TIMESTAMPDIFF(SECOND, s.started_at, NOW()) AS elapsed_seconds,
                v.duration, v.training_category, v.is_active
         FROM rehab_lesson_sessions s JOIN rehab_videos v ON v.id = s.video_id
         WHERE s.id = ? AND s.user_id = ? FOR UPDATE`, [sessionId, userId]
      );
      const session = sessions[0];
      if (!session) throw lessonError('学习记录不存在', 404);
      if (session.status === 'completed') return { success: true, alreadyCompleted: true };
      if (session.status !== 'started') throw lessonError('学习已终止，请重新开始', 409);
      if (!session.is_active || !session.training_category) throw lessonError('视频已下线', 409);
      const required = requiredSeconds(session);
      if (watchedSeconds < required || Number(session.elapsed_seconds) < required) {
        throw lessonError('学习时长不足，请继续播放');
      }
      const creditedSeconds = Math.min(Math.floor(watchedSeconds), Number(session.duration));
      await db.execute(
        "UPDATE rehab_lesson_sessions SET status = 'completed', ended_at = NOW(), watched_seconds = ? WHERE id = ?",
        [creditedSeconds, sessionId]
      );
      // 同一事务写入既有打卡表，保留统计与历史功能；不会经过旧的等级解锁逻辑。
      const [checkin] = await db.execute(
        `INSERT INTO rehab_checkins
         (user_id, duration_plan, video_group, video_count, completed_count, is_completed,
          checkin_date, started_at, completed_at, duration_actual)
         VALUES (?, ?, ?, 1, 1, 1, DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')), ?, NOW(), ?)`,
        [userId, Math.ceil(session.duration / 60), session.training_category, session.started_at, creditedSeconds]
      );
      await db.execute(
        `INSERT INTO rehab_checkin_details (checkin_id, video_id, video_order, is_completed, watched_seconds)
         VALUES (?, ?, 1, 1, ?)`, [checkin.insertId, session.video_id, creditedSeconds]
      );
      return { success: true, alreadyCompleted: false };
    });
  }

  async function stopLesson(userId, rawSessionId) {
    const sessionId = positiveId(rawSessionId);
    return withUserLock(userId, async db => {
      await db.execute(
        "UPDATE rehab_lesson_sessions SET status = 'stopped', ended_at = NOW() WHERE id = ? AND user_id = ? AND status = 'started'",
        [sessionId, userId]
      );
      return { success: true };
    });
  }

  return { getLessons, startLesson, completeLesson, stopLesson };
}

function registerLessonRoutes(app, pool, authenticateToken) {
  const service = createLessonService(pool);
  const route = handler => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await handler(req));
    } catch (error) {
      if (!error.status) console.error('康复视频学习错误:', error);
      res.status(error.status || 500).json({ error: error.status ? error.message : '学习服务暂时不可用，请重试' });
    }
  };
  app.get('/api/rehab/lessons', authenticateToken, route(req => service.getLessons(req.user.userId)));
  app.post('/api/rehab/lessons/:videoId/start', authenticateToken,
    route(req => service.startLesson(req.user.userId, req.params.videoId)));
  app.post('/api/rehab/lesson-sessions/:sessionId/complete', authenticateToken,
    route(req => service.completeLesson(req.user.userId, req.params.sessionId, req.body.watchedSeconds)));
  app.post('/api/rehab/lesson-sessions/:sessionId/stop', authenticateToken,
    route(req => service.stopLesson(req.user.userId, req.params.sessionId)));
}

module.exports = { createLessonService, registerLessonRoutes };
