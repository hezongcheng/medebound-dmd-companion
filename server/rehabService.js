/**
 * 康复视频 + 打卡服务
 */

const { pool } = require('./db');
const REHAB_VIDEO_CACHE_TTL_MS = 5 * 60 * 1000;
const LEVEL_UNLOCK_DAYS = 5;
const rehabVideosCache = new Map();

function getLocalDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || String(date.getFullYear());
  const month = parts.find((p) => p.type === 'month')?.value || String(date.getMonth() + 1).padStart(2, '0');
  const day = parts.find((p) => p.type === 'day')?.value || String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function ensureProgressRow(userId) {
  await pool.execute(
    `INSERT INTO rehab_user_progress (user_id)
     VALUES (?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
    [userId]
  );
}

async function markLevel2Unlocked(userId) {
  await ensureProgressRow(userId);
  await pool.execute(
    `UPDATE rehab_user_progress
     SET level2_unlocked_at = COALESCE(level2_unlocked_at, NOW())
     WHERE user_id = ?`,
    [userId]
  );
  await pool.execute(
    'UPDATE users SET rehab_level2_unlocked = 1 WHERE id = ? AND rehab_level2_unlocked = 0',
    [userId]
  );
}

async function markLevel3Unlocked(userId) {
  await ensureProgressRow(userId);
  await pool.execute(
    `UPDATE rehab_user_progress
     SET level3_unlocked_at = COALESCE(level3_unlocked_at, NOW())
     WHERE user_id = ?`,
    [userId]
  );
  await pool.execute(
    'UPDATE users SET rehab_level3_unlocked = 1 WHERE id = ? AND rehab_level3_unlocked = 0',
    [userId]
  );
}

/**
 * 获取所有启用的康复视频
 * 可按行动状态过滤
 */
async function getRehabVideos(targetStatus = null, videoGroup = null) {
  const cacheKey = `${targetStatus || 'all'}:${videoGroup || 'all'}`;
  const cached = rehabVideosCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let sql = 'SELECT * FROM rehab_videos WHERE is_active = 1';
  const params = [];

  if (targetStatus && targetStatus !== 'all') {
    sql += ' AND (target_status = ? OR target_status = "all")';
    params.push(targetStatus);
  }

  if (videoGroup) {
    sql += ' AND video_group = ?';
    params.push(videoGroup);
  }

  sql += ' ORDER BY sort_order ASC';
  const [rows] = await pool.execute(sql, params);

  rehabVideosCache.set(cacheKey, {
    data: rows,
    expiresAt: Date.now() + REHAB_VIDEO_CACHE_TTL_MS
  });

  return rows;
}

/**
 * 创建康复评估记录
 */
async function createAssessment(userId, contractures, painWarnings) {
  const [result] = await pool.execute(
    'INSERT INTO rehab_assessments (user_id, contractures, pain_warnings) VALUES (?, ?, ?)',
    [userId, contractures, painWarnings]
  );
  return result.insertId;
}

/**
 * 创建打卡记录（开始训练时调用）
 */
async function createCheckin(userId, assessmentId, durationPlan, videoCount, videoGroup) {
  const today = getLocalDateString();
  const [result] = await pool.execute(
    `INSERT INTO rehab_checkins (user_id, assessment_id, duration_plan, video_group, video_count, checkin_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, assessmentId ?? null, durationPlan ?? 10, videoGroup ?? null, videoCount ?? 4, today]
  );
  return result.insertId;
}

/**
 * 记录单个视频完成
 */
async function recordVideoComplete(userId, checkinId, videoId, videoOrder, watchedSeconds) {
  const [checkinRows] = await pool.execute(
    'SELECT id FROM rehab_checkins WHERE id = ? AND user_id = ? LIMIT 1',
    [checkinId, userId]
  );
  if (checkinRows.length === 0) {
    return false;
  }

  const [insertResult] = await pool.execute(
    `INSERT INTO rehab_checkin_details (checkin_id, video_id, video_order, is_completed, watched_seconds)
     VALUES (?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       video_id = VALUES(video_id),
       video_order = VALUES(video_order),
       is_completed = 1,
       watched_seconds = GREATEST(watched_seconds, VALUES(watched_seconds))`,
    [checkinId, videoId, videoOrder, watchedSeconds]
  );

  if (insertResult.affectedRows === 1) {
    // 仅首次插入时累计完成数，保证接口幂等
    await pool.execute(
      'UPDATE rehab_checkins SET completed_count = completed_count + 1 WHERE id = ?',
      [checkinId]
    );
  }
  return true;
}

/**
 * 完成打卡（训练全部结束时调用）
 */
async function completeCheckin(userId, checkinId, { nextReminderTime = null, durationActual = null } = {}) {
  const [updateResult] = await pool.execute(
    `UPDATE rehab_checkins 
     SET is_completed = 1, completed_at = NOW(), next_reminder_time = ?, duration_actual = COALESCE(?, duration_actual)
     WHERE id = ? AND user_id = ? AND is_completed = 0`,
    [nextReminderTime, durationActual, checkinId, userId]
  );
  if (updateResult.affectedRows === 0) {
    return false;
  }

  const [checkinRows] = await pool.execute(
    'SELECT user_id, video_group FROM rehab_checkins WHERE id = ? AND user_id = ?',
    [checkinId, userId]
  );
  if (checkinRows.length > 0) {
    const { user_id, video_group } = checkinRows[0];

    if (video_group === 'level1') {
      const streak = await getLevelStreak(user_id, 'level1');
      await ensureProgressRow(user_id);
      await pool.execute(
        `UPDATE rehab_user_progress
         SET level1_best_streak = GREATEST(level1_best_streak, ?)
         WHERE user_id = ?`,
        [streak, user_id]
      );
      if (streak >= LEVEL_UNLOCK_DAYS) {
        await markLevel2Unlocked(user_id);
      }
    } else if (video_group === 'level2') {
      const streak = await getLevelStreak(user_id, 'level2');
      await ensureProgressRow(user_id);
      await pool.execute(
        `UPDATE rehab_user_progress
         SET level2_best_streak = GREATEST(level2_best_streak, ?)
         WHERE user_id = ?`,
        [streak, user_id]
      );
      if (streak >= LEVEL_UNLOCK_DAYS) {
        await markLevel3Unlocked(user_id);
      }
    }
  }
  return true;
}

async function tickCheckin(userId, checkinId) {
  const [result] = await pool.execute(
    `UPDATE rehab_checkins SET duration_actual = COALESCE(duration_actual, 0) + 1 WHERE id = ? AND user_id = ?`,
    [checkinId, userId]
  );
  return result.affectedRows > 0;
}

async function stopCheckin(userId, checkinId, { durationActual = null } = {}) {
  const [result] = await pool.execute(
    `UPDATE rehab_checkins 
     SET duration_actual = COALESCE(?, duration_actual)
     WHERE id = ? AND user_id = ?`,
    [durationActual, checkinId, userId]
  );
  return result.affectedRows > 0;
}

/**
 * 获取用户的打卡统计
 */
async function getCheckinStats(userId) {
  // 总打卡天数
  const [totalRows] = await pool.execute(
    'SELECT COUNT(DISTINCT checkin_date) AS total_days FROM rehab_checkins WHERE user_id = ? AND is_completed = 1',
    [userId]
  );

  // 连续打卡天数
  const [recentRows] = await pool.execute(
    `SELECT DISTINCT checkin_date FROM rehab_checkins 
     WHERE user_id = ? AND is_completed = 1 
     ORDER BY checkin_date DESC`,
    [userId]
  );

  let streak = 0;
  if (recentRows.length > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < recentRows.length; i++) {
      const checkDate = new Date(recentRows[i].checkin_date);
      checkDate.setHours(0, 0, 0, 0);
      
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);
      
      if (checkDate.getTime() === expectedDate.getTime()) {
        streak++;
      } else if (i === 0) {
        // 今天没打卡，看昨天开始
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (checkDate.getTime() === yesterday.getTime()) {
          streak++;
        } else {
          break;
        }
      } else {
        break;
      }
    }
  }

  // 今日是否已打卡
  const todayStr = getLocalDateString();
  const [todayRows] = await pool.execute(
    'SELECT id, is_completed FROM rehab_checkins WHERE user_id = ? AND checkin_date = ? ORDER BY id DESC LIMIT 1',
    [userId, todayStr]
  );

  // 最近7天打卡记录
  const [weekRows] = await pool.execute(
    `SELECT checkin_date, is_completed, duration_plan, completed_count, video_count 
     FROM rehab_checkins 
     WHERE user_id = ? AND checkin_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) 
     ORDER BY checkin_date DESC`,
    [userId]
  );

  return {
    totalDays: totalRows[0].total_days,
    streak,
    todayCheckin: todayRows.length > 0 ? todayRows[0] : null,
    weekRecords: weekRows
  };
}

/**
 * 获取用户打卡历史
 */
async function getCheckinHistory(userId, limit = 30) {
  const [rows] = await pool.execute(
    `SELECT c.*, COALESCE(d.detail_count, 0) AS detail_count
     FROM rehab_checkins c
     LEFT JOIN (
       SELECT checkin_id, COUNT(*) AS detail_count
       FROM rehab_checkin_details
       GROUP BY checkin_id
     ) d ON d.checkin_id = c.id
     WHERE c.user_id = ?
     ORDER BY c.checkin_date DESC, c.started_at DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows;
}

async function getLevelStreak(userId, videoGroup) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT checkin_date FROM rehab_checkins 
     WHERE user_id = ? AND video_group = ? AND is_completed = 1 
     ORDER BY checkin_date DESC`,
    [userId, videoGroup]
  );

  let streak = 0;
  if (rows.length > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < rows.length; i++) {
      const checkDate = new Date(rows[i].checkin_date);
      checkDate.setHours(0, 0, 0, 0);

      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);

      if (checkDate.getTime() === expectedDate.getTime()) {
        streak++;
      } else if (i === 0) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (checkDate.getTime() === yesterday.getTime()) {
          streak++;
        } else {
          break;
        }
      } else {
        break;
      }
    }
  }
  return streak;
}

async function getMaxLevelStreak(userId, videoGroup) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT checkin_date FROM rehab_checkins 
     WHERE user_id = ? AND video_group = ? AND is_completed = 1 
     ORDER BY checkin_date ASC`,
    [userId, videoGroup]
  );

  if (!rows.length) return 0;

  let maxStreak = 1;
  let currentStreak = 1;

  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].checkin_date);
    const curr = new Date(rows[i].checkin_date);
    prev.setHours(0, 0, 0, 0);
    curr.setHours(0, 0, 0, 0);

    const diffDays = Math.round((curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) {
      currentStreak += 1;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else if (diffDays > 1) {
      currentStreak = 1;
    }
  }

  return maxStreak;
}

async function repairUnlockFlagsIfNeeded(userId, { isLevel2Unlocked, isLevel3Unlocked }) {
  let nextLevel2 = isLevel2Unlocked;
  let nextLevel3 = isLevel3Unlocked;

  await ensureProgressRow(userId);
  const [progressRows] = await pool.execute(
    `SELECT level2_unlocked_at, level3_unlocked_at, level1_best_streak, level2_best_streak
     FROM rehab_user_progress
     WHERE user_id = ?`,
    [userId]
  );
  const progress = progressRows[0] || {};
  if (progress.level2_unlocked_at) nextLevel2 = true;
  if (progress.level3_unlocked_at) nextLevel3 = true;

  if (!nextLevel2 || !nextLevel3) {
    const [hasLevel2RowsResult, hasLevel3RowsResult, level1MaxStreak, level2MaxStreak] = await Promise.all([
      pool.execute(
        `SELECT 1 FROM rehab_checkins 
         WHERE user_id = ? AND video_group IN ('level2', 'level3') AND is_completed = 1 
         LIMIT 1`,
        [userId]
      ),
      pool.execute(
        `SELECT 1 FROM rehab_checkins 
         WHERE user_id = ? AND video_group = 'level3' AND is_completed = 1 
         LIMIT 1`,
        [userId]
      ),
      getMaxLevelStreak(userId, 'level1'),
      getMaxLevelStreak(userId, 'level2')
    ]);

    const hasLevel2History = hasLevel2RowsResult[0].length > 0;
    const hasLevel3History = hasLevel3RowsResult[0].length > 0;

    await pool.execute(
      `UPDATE rehab_user_progress
       SET level1_best_streak = GREATEST(level1_best_streak, ?),
           level2_best_streak = GREATEST(level2_best_streak, ?)
       WHERE user_id = ?`,
      [level1MaxStreak, level2MaxStreak, userId]
    );

    if (!nextLevel2 && (hasLevel2History || level1MaxStreak >= LEVEL_UNLOCK_DAYS || Number(progress.level1_best_streak || 0) >= LEVEL_UNLOCK_DAYS)) {
      await markLevel2Unlocked(userId);
      nextLevel2 = true;
    }

    if (!nextLevel3 && (hasLevel3History || level2MaxStreak >= LEVEL_UNLOCK_DAYS || Number(progress.level2_best_streak || 0) >= LEVEL_UNLOCK_DAYS)) {
      await markLevel3Unlocked(userId);
      nextLevel3 = true;
    }
  }

  return { isLevel2Unlocked: nextLevel2, isLevel3Unlocked: nextLevel3 };
}

async function getCheckinStatsByLevel(userId) {
  await ensureProgressRow(userId);
  const todayStr = getLocalDateString();

  const [
    level1Streak,
    level2Streak,
    level3Streak,
    progressRowsResult,
    todayRowsResult,
    historyRowsResult,
    totalsRowsResult
  ] = await Promise.all([
    getLevelStreak(userId, 'level1'),
    getLevelStreak(userId, 'level2'),
    getLevelStreak(userId, 'level3'),
    pool.execute(
      'SELECT level2_unlocked_at, level3_unlocked_at FROM rehab_user_progress WHERE user_id = ?',
      [userId]
    ),
    pool.execute(
      `SELECT video_group, is_completed FROM rehab_checkins 
       WHERE user_id = ? AND checkin_date = ? AND is_completed = 1`,
      [userId, todayStr]
    ),
    pool.execute(
      `SELECT c.checkin_date, c.video_group, c.duration_plan, c.completed_count, c.video_count, c.is_completed, c.duration_actual
       FROM rehab_checkins c
       WHERE c.user_id = ? AND c.is_completed = 1
       ORDER BY c.checkin_date DESC, c.started_at DESC
       LIMIT 50`,
      [userId]
    ),
    pool.execute(
      `SELECT
         COUNT(DISTINCT checkin_date) AS total_days,
         COALESCE(ROUND(SUM(COALESCE(duration_actual, 0)) / 60), 0) AS total_minutes
       FROM rehab_checkins
       WHERE user_id = ? AND is_completed = 1`,
      [userId]
    )
  ]);

  const progressRows = progressRowsResult[0];
  const todayRows = todayRowsResult[0];
  const historyRows = historyRowsResult[0];
  const totalsRows = totalsRowsResult[0];

  const progress = progressRows[0] || {};
  let isLevel2Unlocked = Boolean(progress.level2_unlocked_at);
  let isLevel3Unlocked = Boolean(progress.level3_unlocked_at);
  ({ isLevel2Unlocked, isLevel3Unlocked } = await repairUnlockFlagsIfNeeded(userId, { isLevel2Unlocked, isLevel3Unlocked }));
  const todayCompletedGroups = todayRows.map(r => r.video_group);

  return {
    level1Streak,
    level2Streak,
    level3Streak,
    isLevel2Unlocked,
    isLevel3Unlocked,
    todayCompletedGroups,
    totalDays: totalsRows[0].total_days,
    totalMinutes: totalsRows[0].total_minutes,
    history: historyRows
  };
}

module.exports = {
  getRehabVideos,
  createAssessment,
  createCheckin,
  recordVideoComplete,
  completeCheckin,
  stopCheckin,
  tickCheckin,
  getCheckinStats,
  getCheckinHistory,
  getLevelStreak,
  getCheckinStatsByLevel
};
