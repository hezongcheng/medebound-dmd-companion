/**
 * 临床试验缓存服务
 * 用于管理trials_cache和trials_ai_cache表的读写操作
 */

const { pool } = require('./db');

/**
 * 获取所有缓存的临床试验（支持按地区筛选）
 */
async function getAllCachedTrials(regionFilter = '') {
  try {
    let sql = `
      SELECT
        nct_id as nctId,
        title,
        title_zh as titleZh,
        status,
        phase,
        conditions,
        locations,
        regions,
        summary,
        summary_zh as summaryZh,
        eligibility,
        eligibility_zh as eligibilityZh,
        study_type as studyType,
        intervention_types as interventionTypes,
        intervention_names as interventionNames,
        lead_sponsor as leadSponsor,
        primary_purpose as primaryPurpose,
        observational_model as observationalModel,
        time_perspective as timePerspective,
        allocation,
        masking,
        enrollment_count as enrollmentCount,
        enrollment_type as enrollmentType,
        sex,
        minimum_age as minimumAge,
        maximum_age as maximumAge,
        healthy_volunteers as healthyVolunteers,
        std_ages as stdAges,
        suggested_materials as suggestedMaterials,
        last_update as lastUpdate,
        fetched_at as fetchedAt,
        created_by_user_id as createdByUserId
      FROM trials_cache
    `;
    const params = [];

    if (regionFilter) {
      // 使用 JSON_CONTAINS 或 LIKE 匹配 regions 字段
      sql += ' WHERE JSON_CONTAINS(regions, ?)';
      params.push(JSON.stringify(regionFilter));
    }

    sql += ' ORDER BY last_update DESC';

    const [rows] = await pool.execute(sql, params);

    // 解析JSON字段
    return rows.map(row => ({
      ...row,
      phase: row.phase ? (typeof row.phase === 'string' ? JSON.parse(row.phase) : row.phase) : [],
      conditions: row.conditions ? (typeof row.conditions === 'string' ? JSON.parse(row.conditions) : row.conditions) : [],
      locations: row.locations ? (typeof row.locations === 'string' ? JSON.parse(row.locations) : row.locations) : [],
      regions: row.regions ? (typeof row.regions === 'string' ? JSON.parse(row.regions) : row.regions) : []
    }));
  } catch (error) {
    console.error('获取缓存试验列表错误:', error.message);
    throw error;
  }
}

/**
 * 根据NCT ID获取单个试验
 */
async function getCachedTrialById(nctId) {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        nct_id as nctId,
        title,
        title_zh as titleZh,
        status,
        phase,
        conditions,
        locations,
        regions,
        summary,
        summary_zh as summaryZh,
        eligibility,
        eligibility_zh as eligibilityZh,
        study_type as studyType,
        intervention_types as interventionTypes,
        intervention_names as interventionNames,
        lead_sponsor as leadSponsor,
        primary_purpose as primaryPurpose,
        observational_model as observationalModel,
        time_perspective as timePerspective,
        allocation,
        masking,
        enrollment_count as enrollmentCount,
        enrollment_type as enrollmentType,
        sex,
        minimum_age as minimumAge,
        maximum_age as maximumAge,
        healthy_volunteers as healthyVolunteers,
        std_ages as stdAges,
        suggested_materials as suggestedMaterials,
        last_update as lastUpdate,
        fetched_at as fetchedAt,
        created_by_user_id as createdByUserId
      FROM trials_cache 
      WHERE nct_id = ?
    `, [nctId]);
    
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      ...row,
      phase: row.phase ? (typeof row.phase === 'string' ? JSON.parse(row.phase) : row.phase) : [],
      conditions: row.conditions ? (typeof row.conditions === 'string' ? JSON.parse(row.conditions) : row.conditions) : [],
      locations: row.locations ? (typeof row.locations === 'string' ? JSON.parse(row.locations) : row.locations) : [],
      regions: row.regions ? (typeof row.regions === 'string' ? JSON.parse(row.regions) : row.regions) : [],
      interventionTypes: row.interventionTypes ? (typeof row.interventionTypes === 'string' ? JSON.parse(row.interventionTypes) : row.interventionTypes) : [],
      interventionNames: row.interventionNames ? (typeof row.interventionNames === 'string' ? JSON.parse(row.interventionNames) : row.interventionNames) : [],
      stdAges: row.stdAges ? (typeof row.stdAges === 'string' ? JSON.parse(row.stdAges) : row.stdAges) : [],
      suggestedMaterials: row.suggestedMaterials ? (typeof row.suggestedMaterials === 'string' ? JSON.parse(row.suggestedMaterials) : row.suggestedMaterials) : []
    };
  } catch (error) {
    console.error('获取缓存试验错误:', error.message);
    throw error;
  }
}

/**
 * 保存或更新临床试验到缓存
 */
async function saveCachedTrial(trial) {
  try {
    const sql = `
      INSERT INTO trials_cache 
        (nct_id, title, title_zh, status, phase, conditions, locations, regions, 
         summary, summary_zh, eligibility, eligibility_zh, study_type, intervention_types, intervention_names,
         lead_sponsor, primary_purpose, observational_model, time_perspective, allocation, masking,
         enrollment_count, enrollment_type, sex, minimum_age, maximum_age, healthy_volunteers, std_ages, suggested_materials,
         last_update, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        title_zh = VALUES(title_zh),
        status = VALUES(status),
        phase = VALUES(phase),
        conditions = VALUES(conditions),
        locations = VALUES(locations),
        regions = VALUES(regions),
        summary = VALUES(summary),
        summary_zh = VALUES(summary_zh),
        eligibility = VALUES(eligibility),
        eligibility_zh = VALUES(eligibility_zh),
        study_type = VALUES(study_type),
        intervention_types = VALUES(intervention_types),
        intervention_names = VALUES(intervention_names),
        lead_sponsor = VALUES(lead_sponsor),
        primary_purpose = VALUES(primary_purpose),
        observational_model = VALUES(observational_model),
        time_perspective = VALUES(time_perspective),
        allocation = VALUES(allocation),
        masking = VALUES(masking),
        enrollment_count = VALUES(enrollment_count),
        enrollment_type = VALUES(enrollment_type),
        sex = VALUES(sex),
        minimum_age = VALUES(minimum_age),
        maximum_age = VALUES(maximum_age),
        healthy_volunteers = VALUES(healthy_volunteers),
        std_ages = VALUES(std_ages),
        suggested_materials = VALUES(suggested_materials),
        last_update = VALUES(last_update),
        created_by_user_id = COALESCE(trials_cache.created_by_user_id, VALUES(created_by_user_id)),
        updated_at = NOW()
    `;
    
    await pool.execute(sql, [
      trial.nctId,
      trial.title,
      trial.titleZh || null,
      trial.status || null,
      JSON.stringify(trial.phase || []),
      JSON.stringify(trial.conditions || []),
      JSON.stringify(trial.locations || []),
      JSON.stringify(trial.regions || []),
      trial.summary || null,
      trial.summaryZh || null,
      trial.eligibility || null,
      trial.eligibilityZh || null,
      trial.studyType || null,
      JSON.stringify(trial.interventionTypes || []),
      JSON.stringify(trial.interventionNames || []),
      trial.leadSponsor || null,
      trial.primaryPurpose || null,
      trial.observationalModel || null,
      trial.timePerspective || null,
      trial.allocation || null,
      trial.masking || null,
      trial.enrollmentCount ?? null,
      trial.enrollmentType || null,
      trial.sex || null,
      trial.minimumAge || null,
      trial.maximumAge || null,
      trial.healthyVolunteers || null,
      JSON.stringify(trial.stdAges || []),
      JSON.stringify(trial.suggestedMaterials || []),
      trial.lastUpdate || null,
      trial.createdByUserId || null
    ]);
    
    console.log(`✅ 试验缓存已保存: ${trial.nctId}`);
    return true;
  } catch (error) {
    console.error('保存试验缓存错误:', error.message);
    throw error;
  }
}

/**
 * 批量保存临床试验
 */
async function batchSaveTrials(trials) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    for (const trial of trials) {
      await connection.execute(`
        INSERT INTO trials_cache 
          (nct_id, title, title_zh, status, phase, conditions, locations, regions, 
           summary, summary_zh, eligibility, eligibility_zh, study_type, intervention_types, intervention_names,
           lead_sponsor, primary_purpose, observational_model, time_perspective, allocation, masking,
           enrollment_count, enrollment_type, sex, minimum_age, maximum_age, healthy_volunteers, std_ages, suggested_materials,
           last_update, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          title_zh = VALUES(title_zh),
          status = VALUES(status),
          phase = VALUES(phase),
          conditions = VALUES(conditions),
          locations = VALUES(locations),
          regions = VALUES(regions),
          summary = VALUES(summary),
          summary_zh = VALUES(summary_zh),
          eligibility = VALUES(eligibility),
          eligibility_zh = VALUES(eligibility_zh),
          study_type = VALUES(study_type),
          intervention_types = VALUES(intervention_types),
          intervention_names = VALUES(intervention_names),
          lead_sponsor = VALUES(lead_sponsor),
          primary_purpose = VALUES(primary_purpose),
          observational_model = VALUES(observational_model),
          time_perspective = VALUES(time_perspective),
          allocation = VALUES(allocation),
          masking = VALUES(masking),
          enrollment_count = VALUES(enrollment_count),
          enrollment_type = VALUES(enrollment_type),
          sex = VALUES(sex),
          minimum_age = VALUES(minimum_age),
          maximum_age = VALUES(maximum_age),
          healthy_volunteers = VALUES(healthy_volunteers),
          std_ages = VALUES(std_ages),
          suggested_materials = VALUES(suggested_materials),
          last_update = VALUES(last_update),
          created_by_user_id = COALESCE(trials_cache.created_by_user_id, VALUES(created_by_user_id)),
          updated_at = NOW()
      `, [
        trial.nctId,
        trial.title,
        trial.titleZh || null,
        trial.status || null,
        JSON.stringify(trial.phase || []),
        JSON.stringify(trial.conditions || []),
        JSON.stringify(trial.locations || []),
        JSON.stringify(trial.regions || []),
        trial.summary || null,
        trial.summaryZh || null,
        trial.eligibility || null,
        trial.eligibilityZh || null,
        trial.studyType || null,
        JSON.stringify(trial.interventionTypes || []),
        JSON.stringify(trial.interventionNames || []),
        trial.leadSponsor || null,
        trial.primaryPurpose || null,
        trial.observationalModel || null,
        trial.timePerspective || null,
        trial.allocation || null,
        trial.masking || null,
        trial.enrollmentCount ?? null,
        trial.enrollmentType || null,
        trial.sex || null,
        trial.minimumAge || null,
        trial.maximumAge || null,
        trial.healthyVolunteers || null,
        JSON.stringify(trial.stdAges || []),
        JSON.stringify(trial.suggestedMaterials || []),
        trial.lastUpdate || null,
        trial.createdByUserId || null
      ]);
    }
    
    await connection.commit();
    console.log(`✅ 批量保存 ${trials.length} 条试验缓存`);
    return true;
  } catch (error) {
    await connection.rollback();
    console.error('批量保存试验缓存错误:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 删除缓存的试验
 */
async function deleteCachedTrial(nctId) {
  try {
    await pool.execute('DELETE FROM trials_cache WHERE nct_id = ?', [nctId]);
    console.log(`🗑️ 试验缓存已删除: ${nctId}`);
    return true;
  } catch (error) {
    console.error('删除试验缓存错误:', error.message);
    throw error;
  }
}

/**
 * 获取试验AI解读缓存
 */
async function getTrialAICache(nctId, profileHash) {
  try {
    const [rows] = await pool.execute(`
      SELECT analysis_text, created_at, expires_at
      FROM trials_ai_cache 
      WHERE nct_id = ? AND profile_hash = ? AND (expires_at IS NULL OR expires_at > NOW())
    `, [nctId, profileHash]);
    
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('获取试验AI缓存错误:', error.message);
    return null;
  }
}

/**
 * 保存试验AI解读缓存
 */
async function saveTrialAICache(nctId, profileHash, analysisText, expiresDays = 7) {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresDays);
    
    await pool.execute(`
      INSERT INTO trials_ai_cache (nct_id, profile_hash, analysis_text, expires_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        analysis_text = VALUES(analysis_text),
        expires_at = VALUES(expires_at),
        created_at = NOW()
    `, [nctId, profileHash, analysisText, expiresAt]);
    
    console.log(`✅ 试验AI解读缓存已保存: ${nctId}`);
    return true;
  } catch (error) {
    console.error('保存试验AI缓存错误:', error.message);
    return false;
  }
}

/**
 * 清理过期的AI缓存
 */
async function cleanExpiredTrialAICache() {
  try {
    const [result] = await pool.execute(
      'DELETE FROM trials_ai_cache WHERE expires_at IS NOT NULL AND expires_at < NOW()'
    );
    console.log(`🧹 清理了 ${result.affectedRows} 条过期的试验AI缓存`);
    return result.affectedRows;
  } catch (error) {
    console.error('清理过期试验AI缓存错误:', error.message);
    return 0;
  }
}

/**
 * 获取缓存统计信息
 */
async function getTrialCacheStats() {
  try {
    const [trialCount] = await pool.execute('SELECT COUNT(*) as count FROM trials_cache');
    const [aiCacheCount] = await pool.execute('SELECT COUNT(*) as count FROM trials_ai_cache');
    const [latestTrial] = await pool.execute(
      'SELECT nct_id, title, fetched_at FROM trials_cache ORDER BY fetched_at DESC LIMIT 1'
    );
    
    return {
      totalTrials: trialCount[0].count,
      totalAICache: aiCacheCount[0].count,
      latestTrial: latestTrial[0] || null
    };
  } catch (error) {
    console.error('获取试验缓存统计错误:', error.message);
    return { totalTrials: 0, totalAICache: 0, latestTrial: null };
  }
}

async function getUserFetchedTrials(userId, searchKeyword = '', page = 1, pageSize = 10) {
  try {
    let searchCondition = ' WHERE created_by_user_id = ?';
    const params = [userId];

    if (searchKeyword) {
      const kw = '%' + searchKeyword + '%';
      searchCondition += " AND (nct_id LIKE ? OR title LIKE ? OR title_zh LIKE ? OR summary LIKE ? OR summary_zh LIKE ?)";
      params.push(kw, kw, kw, kw, kw);
    }

    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset = (safePage - 1) * safePageSize;

    const sql = `SELECT
      nct_id as nctId,
      title,
      title_zh as titleZh,
      status,
      phase,
      conditions,
      locations,
      regions,
      summary,
      summary_zh as summaryZh,
      eligibility,
      eligibility_zh as eligibilityZh,
      study_type as studyType,
      intervention_types as interventionTypes,
      intervention_names as interventionNames,
      lead_sponsor as leadSponsor,
      primary_purpose as primaryPurpose,
      observational_model as observationalModel,
      time_perspective as timePerspective,
      allocation,
      masking,
      enrollment_count as enrollmentCount,
      enrollment_type as enrollmentType,
      sex,
      minimum_age as minimumAge,
      maximum_age as maximumAge,
      healthy_volunteers as healthyVolunteers,
      std_ages as stdAges,
      suggested_materials as suggestedMaterials,
      last_update as lastUpdate,
      fetched_at as fetchedAt,
      created_by_user_id as createdByUserId
    FROM trials_cache${searchCondition}
    ORDER BY fetched_at DESC
    LIMIT ${safePageSize} OFFSET ${offset}`;

    const [rows] = await pool.execute(sql, params);
    return rows.map(row => ({
      ...row,
      phase: row.phase ? (typeof row.phase === 'string' ? JSON.parse(row.phase) : row.phase) : [],
      conditions: row.conditions ? (typeof row.conditions === 'string' ? JSON.parse(row.conditions) : row.conditions) : [],
      locations: row.locations ? (typeof row.locations === 'string' ? JSON.parse(row.locations) : row.locations) : [],
      regions: row.regions ? (typeof row.regions === 'string' ? JSON.parse(row.regions) : row.regions) : [],
      interventionTypes: row.interventionTypes ? (typeof row.interventionTypes === 'string' ? JSON.parse(row.interventionTypes) : row.interventionTypes) : [],
      interventionNames: row.interventionNames ? (typeof row.interventionNames === 'string' ? JSON.parse(row.interventionNames) : row.interventionNames) : [],
      stdAges: row.stdAges ? (typeof row.stdAges === 'string' ? JSON.parse(row.stdAges) : row.stdAges) : [],
      suggestedMaterials: row.suggestedMaterials ? (typeof row.suggestedMaterials === 'string' ? JSON.parse(row.suggestedMaterials) : row.suggestedMaterials) : []
    }));
  } catch (error) {
    console.error('获取用户定向抓取试验错误:', error.message);
    return [];
  }
}

async function getUserFetchedTrialsCount(userId, searchKeyword = '') {
  try {
    let searchCondition = ' WHERE created_by_user_id = ?';
    const params = [userId];

    if (searchKeyword) {
      const kw = '%' + searchKeyword + '%';
      searchCondition += " AND (nct_id LIKE ? OR title LIKE ? OR title_zh LIKE ? OR summary LIKE ? OR summary_zh LIKE ?)";
      params.push(kw, kw, kw, kw, kw);
    }

    const [result] = await pool.execute(
      `SELECT COUNT(*) as total FROM trials_cache${searchCondition}`,
      params
    );
    return result[0]?.total || 0;
  } catch (error) {
    console.error('获取用户定向抓取试验总数错误:', error.message);
    return 0;
  }
}

async function getRandomUserFetchedTrials(limit = 9) {
  try {
    const safeLimit = Math.min(30, Math.max(1, parseInt(limit, 10) || 9));
    const [rows] = await pool.execute(`
      SELECT
        nct_id as nctId,
        title,
        title_zh as titleZh,
        status,
        phase,
        conditions,
        locations,
        regions,
        summary,
        summary_zh as summaryZh,
        eligibility,
        eligibility_zh as eligibilityZh,
        study_type as studyType,
        intervention_types as interventionTypes,
        intervention_names as interventionNames,
        lead_sponsor as leadSponsor,
        primary_purpose as primaryPurpose,
        observational_model as observationalModel,
        time_perspective as timePerspective,
        allocation,
        masking,
        enrollment_count as enrollmentCount,
        enrollment_type as enrollmentType,
        sex,
        minimum_age as minimumAge,
        maximum_age as maximumAge,
        healthy_volunteers as healthyVolunteers,
        std_ages as stdAges,
        suggested_materials as suggestedMaterials,
        last_update as lastUpdate,
        fetched_at as fetchedAt,
        created_by_user_id as createdByUserId
      FROM trials_cache
      WHERE created_by_user_id IS NOT NULL
      ORDER BY RAND()
      LIMIT ${safeLimit}
    `);
    return rows.map(row => ({
      ...row,
      phase: row.phase ? (typeof row.phase === 'string' ? JSON.parse(row.phase) : row.phase) : [],
      conditions: row.conditions ? (typeof row.conditions === 'string' ? JSON.parse(row.conditions) : row.conditions) : [],
      locations: row.locations ? (typeof row.locations === 'string' ? JSON.parse(row.locations) : row.locations) : [],
      regions: row.regions ? (typeof row.regions === 'string' ? JSON.parse(row.regions) : row.regions) : [],
      interventionTypes: row.interventionTypes ? (typeof row.interventionTypes === 'string' ? JSON.parse(row.interventionTypes) : row.interventionTypes) : [],
      interventionNames: row.interventionNames ? (typeof row.interventionNames === 'string' ? JSON.parse(row.interventionNames) : row.interventionNames) : [],
      stdAges: row.stdAges ? (typeof row.stdAges === 'string' ? JSON.parse(row.stdAges) : row.stdAges) : [],
      suggestedMaterials: row.suggestedMaterials ? (typeof row.suggestedMaterials === 'string' ? JSON.parse(row.suggestedMaterials) : row.suggestedMaterials) : []
    }));
  } catch (error) {
    console.error('获取随机用户抓取试验错误:', error.message);
    return [];
  }
}

module.exports = {
  getAllCachedTrials,
  getCachedTrialById,
  saveCachedTrial,
  batchSaveTrials,
  deleteCachedTrial,
  getTrialAICache,
  saveTrialAICache,
  cleanExpiredTrialAICache,
  getTrialCacheStats,
  getUserFetchedTrials,
  getUserFetchedTrialsCount,
  getRandomUserFetchedTrials
};
