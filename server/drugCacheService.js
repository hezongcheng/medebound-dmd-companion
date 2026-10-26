/**
 * FDA药物缓存服务
 * 用于管理fda_drugs_cache和drugs_ai_cache表的读写操作
 */

const { pool } = require('./db');

// 数据源对齐：来自修改前项目 DMD-Comp-main/services/fdaService.ts 的 FALLBACK_DRUGS
const DEFAULT_DMD_DRUGS = [
  {
    brandName: 'Elevidys',
    brandNameCn: '依力维迪',
    genericName: 'delandistrogene moxeparvovec-rokl',
    genericNameCn: '德兰替隆基因',
    manufacturer: 'Sarepta Therapeutics',
    approvalDate: '2023-06-01',
    approvalYear: 2023,
    indication: '用于治疗携带DMD基因确证突变的患者。',
    indicationZh: '用于治疗携带DMD基因确证突变的患者。',
    dosage: '单次静脉注射。',
    dosageZh: '单次静脉注射。',
    labelUrl: 'https://www.fda.gov/vaccines-blood-biologics/elevidys',
    chinaStatus: 'clinical_trial',
    chinaStatusNote: '中国以临床推进和引进评估为主。'
  },
  {
    brandName: 'Duvyzat',
    brandNameCn: '杜维扎特',
    genericName: 'givinostat',
    genericNameCn: '吉维诺他',
    manufacturer: 'Italfarmaco',
    approvalDate: '2024-03-01',
    approvalYear: 2024,
    indication: '用于治疗6岁及以上的DMD患者。',
    indicationZh: '用于治疗6岁及以上的DMD患者。',
    dosage: '口服，每日两次。',
    dosageZh: '口服，每日两次。',
    labelUrl: 'https://www.fda.gov/drugs/drug-approvals-and-databases/fda-approves-non-steroidal-treatment-duchenne-muscular-dystrophy',
    chinaStatus: 'clinical_trial',
    chinaStatusNote: '中国区域仍在推进临床与注册。'
  },
  {
    brandName: 'Agamree',
    brandNameCn: '阿加美瑞',
    genericName: 'vamorolone',
    genericNameCn: '瓦莫洛酮',
    manufacturer: 'Santhera Pharmaceuticals',
    approvalDate: '2023-10-01',
    approvalYear: 2023,
    indication: '用于治疗2岁及以上DMD患者。',
    indicationZh: '用于治疗2岁及以上DMD患者。',
    dosage: '每日口服一次。',
    dosageZh: '每日口服一次。',
    labelUrl: 'https://www.fda.gov/drugs/resources-information-approved-drugs/fda-approves-vamorolone-duchenne-muscular-dystrophy',
    chinaStatus: 'clinical_trial',
    chinaStatusNote: '中国区域仍在推进临床与注册。'
  },
  {
    brandName: 'Exondys 51',
    brandNameCn: '依特普利生',
    genericName: 'eteplirsen',
    genericNameCn: '',
    manufacturer: 'Sarepta Therapeutics',
    approvalDate: '2016-09-01',
    approvalYear: 2016,
    indication: '适用于可进行外显子51跳跃治疗的DMD患者。',
    indicationZh: '适用于可进行外显子51跳跃治疗的DMD患者。',
    dosage: 'Weekly IV infusion.',
    dosageZh: '每周静脉输注。',
    labelUrl: 'https://www.fda.gov/news-events/press-announcements/fda-grants-accelerated-approval-first-drug-duchenne-muscular-dystrophy',
    chinaStatus: 'not_available',
    chinaStatusNote: '中国大陆尚未正式上市。'
  },
  {
    brandName: 'Vyondys 53',
    brandNameCn: '维昇迪斯53',
    genericName: 'golodirsen',
    genericNameCn: '',
    manufacturer: 'Sarepta Therapeutics',
    approvalDate: '2019-12-01',
    approvalYear: 2019,
    indication: '适用于可进行外显子53跳跃治疗的DMD患者。',
    indicationZh: '适用于可进行外显子53跳跃治疗的DMD患者。',
    dosage: 'Weekly IV infusion.',
    dosageZh: '每周静脉输注。',
    labelUrl: 'https://www.fda.gov',
    chinaStatus: 'not_available',
    chinaStatusNote: '中国大陆尚未正式上市。'
  },
  {
    brandName: 'Viltepso',
    brandNameCn: '维特普索',
    genericName: 'viltolarsen',
    genericNameCn: '',
    manufacturer: 'NS Pharma',
    approvalDate: '2020-08-01',
    approvalYear: 2020,
    indication: '适用于可进行外显子53跳跃治疗的DMD患者。',
    indicationZh: '适用于可进行外显子53跳跃治疗的DMD患者。',
    dosage: 'Weekly IV infusion.',
    dosageZh: '每周静脉输注。',
    labelUrl: 'https://www.fda.gov',
    chinaStatus: 'not_available',
    chinaStatusNote: '中国大陆尚未正式上市。'
  },
  {
    brandName: 'Amondys 45',
    brandNameCn: '',
    genericName: 'casimersen',
    genericNameCn: '',
    manufacturer: 'Sarepta Therapeutics',
    approvalDate: '2021-02-01',
    approvalYear: 2021,
    indication: '适用于可进行外显子45跳跃治疗的DMD患者。',
    indicationZh: '适用于可进行外显子45跳跃治疗的DMD患者。',
    dosage: 'Weekly IV infusion.',
    dosageZh: '每周静脉输注。',
    labelUrl: 'https://www.fda.gov',
    chinaStatus: 'not_available',
    chinaStatusNote: '中国大陆尚未正式上市。'
  },
  {
    brandName: 'Emflaza',
    brandNameCn: '恩氟扎',
    genericName: 'deflazacort',
    genericNameCn: '',
    manufacturer: 'PTC Therapeutics',
    approvalDate: '2017-02-01',
    approvalYear: 2017,
    indication: '用于治疗2岁及以上的DMD患者。',
    indicationZh: '用于治疗2岁及以上的DMD患者。',
    dosage: '每日口服一次。',
    dosageZh: '每日口服一次。',
    labelUrl: 'https://www.fda.gov',
    chinaStatus: 'approved',
    chinaStatusNote: '中国可及性较高，请遵医嘱使用。'
  }
];

async function ensureDefaultDrugsSeedSynced() {
  for (const drug of DEFAULT_DMD_DRUGS) {
    await saveCachedDrug(drug);
  }
}

/**
 * 获取所有缓存的FDA药物
 */
async function getAllCachedDrugs(searchKeyword = '') {
  try {
    await ensureDefaultDrugsSeedSynced();

    let sql = `
      SELECT
        id,
        brand_name as brandName,
        brand_name_cn as brandNameCn,
        generic_name as genericName,
        generic_name_cn as genericNameCn,
        manufacturer,
        approval_date as approvalDate,
        approval_year as approvalYear,
        indication,
        indication_zh as indicationZh,
        dosage,
        dosage_zh as dosageZh,
        label_url as labelUrl,
        china_status as chinaStatus,
        china_status_note as chinaStatusNote,
        fetched_at as fetchedAt
      FROM fda_drugs_cache
    `;
    const params = [];

    if (searchKeyword) {
      const kw = '%' + searchKeyword + '%';
      sql += ' WHERE brand_name LIKE ? OR brand_name_cn LIKE ? OR generic_name LIKE ? OR generic_name_cn LIKE ?';
      params.push(kw, kw, kw, kw);
    }

    sql += ' ORDER BY approval_date DESC';

    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('获取缓存药物列表错误:', error.message);
    throw error;
  }
}

/**
 * 根据品牌名获取单个药物
 */
async function getCachedDrugByBrandName(brandName) {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        id,
        brand_name as brandName,
        brand_name_cn as brandNameCn,
        generic_name as genericName,
        generic_name_cn as genericNameCn,
        manufacturer,
        approval_date as approvalDate,
        approval_year as approvalYear,
        indication,
        indication_zh as indicationZh,
        dosage,
        dosage_zh as dosageZh,
        label_url as labelUrl,
        china_status as chinaStatus,
        china_status_note as chinaStatusNote,
        fetched_at as fetchedAt
      FROM fda_drugs_cache
      WHERE brand_name = ?
    `, [brandName]);
    
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('获取缓存药物错误:', error.message);
    throw error;
  }
}

/**
 * 根据ID获取单个药物
 */
async function getCachedDrugById(id) {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        id,
        brand_name as brandName,
        brand_name_cn as brandNameCn,
        generic_name as genericName,
        generic_name_cn as genericNameCn,
        manufacturer,
        approval_date as approvalDate,
        approval_year as approvalYear,
        indication,
        indication_zh as indicationZh,
        dosage,
        dosage_zh as dosageZh,
        label_url as labelUrl,
        china_status as chinaStatus,
        china_status_note as chinaStatusNote,
        fetched_at as fetchedAt
      FROM fda_drugs_cache
      WHERE id = ?
    `, [id]);
    
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('获取缓存药物错误:', error.message);
    throw error;
  }
}

/**
 * 保存或更新FDA药物到缓存
 */
async function saveCachedDrug(drug) {
  try {
    const sql = `
      INSERT INTO fda_drugs_cache
        (brand_name, brand_name_cn, generic_name, generic_name_cn, manufacturer,
         approval_date, approval_year, indication, indication_zh, dosage, dosage_zh, label_url,
         china_status, china_status_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        brand_name_cn = VALUES(brand_name_cn),
        generic_name = VALUES(generic_name),
        generic_name_cn = VALUES(generic_name_cn),
        manufacturer = VALUES(manufacturer),
        approval_date = VALUES(approval_date),
        approval_year = VALUES(approval_year),
        indication = VALUES(indication),
        indication_zh = VALUES(indication_zh),
        dosage = VALUES(dosage),
        dosage_zh = VALUES(dosage_zh),
        label_url = VALUES(label_url),
        china_status = VALUES(china_status),
        china_status_note = VALUES(china_status_note),
        updated_at = NOW()
    `;

    await pool.execute(sql, [
      drug.brandName,
      drug.brandNameCn || null,
      drug.genericName,
      drug.genericNameCn || null,
      drug.manufacturer || null,
      drug.approvalDate || null,
      drug.approvalYear || null,
      drug.indication || null,
      drug.indicationZh || null,
      drug.dosage || null,
      drug.dosageZh || null,
      drug.labelUrl || null,
      drug.chinaStatus || null,
      drug.chinaStatusNote || null
    ]);
    
    console.log(`✅ 药物缓存已保存: ${drug.brandName}`);
    return true;
  } catch (error) {
    console.error('保存药物缓存错误:', error.message);
    throw error;
  }
}

/**
 * 批量保存FDA药物
 */
async function batchSaveDrugs(drugs) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    for (const drug of drugs) {
      await connection.execute(`
        INSERT INTO fda_drugs_cache
          (brand_name, brand_name_cn, generic_name, generic_name_cn, manufacturer,
           approval_date, approval_year, indication, indication_zh, dosage, dosage_zh, label_url,
           china_status, china_status_note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          brand_name_cn = VALUES(brand_name_cn),
          generic_name = VALUES(generic_name),
          generic_name_cn = VALUES(generic_name_cn),
          manufacturer = VALUES(manufacturer),
          approval_date = VALUES(approval_date),
          approval_year = VALUES(approval_year),
          indication = VALUES(indication),
          indication_zh = VALUES(indication_zh),
          dosage = VALUES(dosage),
          dosage_zh = VALUES(dosage_zh),
          label_url = VALUES(label_url),
          china_status = VALUES(china_status),
          china_status_note = VALUES(china_status_note),
          updated_at = NOW()
      `, [
        drug.brandName,
        drug.brandNameCn || null,
        drug.genericName,
        drug.genericNameCn || null,
        drug.manufacturer || null,
        drug.approvalDate || null,
        drug.approvalYear || null,
        drug.indication || null,
        drug.indicationZh || null,
        drug.dosage || null,
        drug.dosageZh || null,
        drug.labelUrl || null,
        drug.chinaStatus || null,
        drug.chinaStatusNote || null
      ]);
    }
    
    await connection.commit();
    console.log(`✅ 批量保存 ${drugs.length} 条药物缓存`);
    return true;
  } catch (error) {
    await connection.rollback();
    console.error('批量保存药物缓存错误:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 删除缓存的药物
 */
async function deleteCachedDrug(brandName) {
  try {
    await pool.execute('DELETE FROM fda_drugs_cache WHERE brand_name = ?', [brandName]);
    console.log(`🗑️ 药物缓存已删除: ${brandName}`);
    return true;
  } catch (error) {
    console.error('删除药物缓存错误:', error.message);
    throw error;
  }
}

/**
 * 获取药物AI解读缓存
 */
async function getDrugAICache(brandName, profileHash) {
  try {
    const [rows] = await pool.execute(`
      SELECT analysis_text, created_at, expires_at
      FROM drugs_ai_cache 
      WHERE brand_name = ? AND profile_hash = ? AND (expires_at IS NULL OR expires_at > NOW())
    `, [brandName, profileHash]);
    
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error('获取药物AI缓存错误:', error.message);
    return null;
  }
}

/**
 * 保存药物AI解读缓存
 */
async function saveDrugAICache(brandName, profileHash, analysisText, expiresDays = 7) {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresDays);
    
    await pool.execute(`
      INSERT INTO drugs_ai_cache (brand_name, profile_hash, analysis_text, expires_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        analysis_text = VALUES(analysis_text),
        expires_at = VALUES(expires_at),
        created_at = NOW()
    `, [brandName, profileHash, analysisText, expiresAt]);
    
    console.log(`✅ 药物AI解读缓存已保存: ${brandName}`);
    return true;
  } catch (error) {
    console.error('保存药物AI缓存错误:', error.message);
    return false;
  }
}

/**
 * 清理过期的AI缓存
 */
async function cleanExpiredDrugAICache() {
  try {
    const [result] = await pool.execute(
      'DELETE FROM drugs_ai_cache WHERE expires_at IS NOT NULL AND expires_at < NOW()'
    );
    console.log(`🧹 清理了 ${result.affectedRows} 条过期的药物AI缓存`);
    return result.affectedRows;
  } catch (error) {
    console.error('清理过期药物AI缓存错误:', error.message);
    return 0;
  }
}

/**
 * 获取缓存统计信息
 */
async function getDrugCacheStats() {
  try {
    const [drugCount] = await pool.execute('SELECT COUNT(*) as count FROM fda_drugs_cache');
    const [aiCacheCount] = await pool.execute('SELECT COUNT(*) as count FROM drugs_ai_cache');
    const [latestDrug] = await pool.execute(
      'SELECT brand_name, generic_name, fetched_at FROM fda_drugs_cache ORDER BY fetched_at DESC LIMIT 1'
    );
    
    return {
      totalDrugs: drugCount[0].count,
      totalAICache: aiCacheCount[0].count,
      latestDrug: latestDrug[0] || null
    };
  } catch (error) {
    console.error('获取药物缓存统计错误:', error.message);
    return { totalDrugs: 0, totalAICache: 0, latestDrug: null };
  }
}

module.exports = {
  getAllCachedDrugs,
  getCachedDrugByBrandName,
  getCachedDrugById,
  saveCachedDrug,
  batchSaveDrugs,
  deleteCachedDrug,
  getDrugAICache,
  saveDrugAICache,
  cleanExpiredDrugAICache,
  getDrugCacheStats
};
