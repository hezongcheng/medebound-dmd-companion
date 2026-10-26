/**
 * 临床试验抓取与翻译入库服务
 * 从 ClinicalTrials.gov 拉取 DMD 试验，翻译后写入 trials_cache
 */

const axios = require('axios');
const { pool } = require('./db');
const trialCacheService = require('./trialCacheService');
const { translateToZh } = require('./youdaoTranslateService');

const CLINICAL_TRIALS_BASE_URL = 'https://clinicaltrials.gov/api/v2/studies';
const DEFAULT_PAGE_SIZE = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function detectRegions(locations = []) {
  const regions = new Set();
  const locString = JSON.stringify(locations).toLowerCase();

  // 中国大陆单独作为一个地区，方便中国患者筛选
  if (locString.includes('china') && !locString.includes('taiwan')) regions.add('中国大陆');
  if (locString.includes('taiwan')) regions.add('中国台湾');
  if (locString.includes('japan')) regions.add('日本');
  if (locString.includes('korea')) regions.add('韩国');

  // 亚洲整体（包含中国大陆、中国台湾、日本、韩国及其他亚洲国家）
  if (locString.includes('china') || locString.includes('japan') || locString.includes('korea') ||
      locString.includes('taiwan') || locString.includes('singapore') || locString.includes('india') ||
      locString.includes('thailand') || locString.includes('malaysia') || locString.includes('hong kong')) {
    regions.add('亚洲');
  }

  if (locString.includes('united states') || locString.includes('canada')) regions.add('北美');
  if (locString.includes('france') || locString.includes('germany') || locString.includes('united kingdom') ||
      locString.includes('italy') || locString.includes('spain') || locString.includes('sweden') ||
      locString.includes('netherlands') || locString.includes('belgium') || locString.includes('switzerland') ||
      locString.includes('denmark') || locString.includes('norway') || locString.includes('finland') ||
      locString.includes('austria') || locString.includes('poland') || locString.includes('portugal') ||
      locString.includes('ireland') || locString.includes('greece') || locString.includes('czech') ||
      locString.includes('hungary')) regions.add('欧洲');

  if (locString.includes('australia') || locString.includes('zealand')) regions.add('大洋洲');
  if (locString.includes('brazil') || locString.includes('argentina') || locString.includes('chile') ||
      locString.includes('colombia') || locString.includes('mexico') || locString.includes('peru')) regions.add('南美洲');

  return Array.from(regions);
}

function inferSuggestedMaterialsFromEligibility(eligibility = '', title = '', conditions = []) {
  const text = `${eligibility} ${title} ${(conditions || []).join(' ')}`.toLowerCase();
  const materials = new Set();

  if (text.includes('genetic') || text.includes('mutation') || text.includes('dystrophin') || text.includes('基因')) {
    materials.add('基因报告');
  }
  if (text.includes('medical history') || text.includes('病史') || text.includes('diagnosis')) {
    materials.add('基础病史');
  }
  if (text.includes('mri') || text.includes('imaging') || text.includes('影像')) {
    materials.add('影像检查');
  }
  if (text.includes('ecg') || text.includes('cardiac') || text.includes('heart') || text.includes('心功能')) {
    materials.add('心肺评估');
  }
  if (text.includes('biopsy') || text.includes('muscle')) {
    materials.add('肌肉相关检查');
  }

  if (materials.size === 0) {
    materials.add('基础病史');
    materials.add('基因报告');
  }

  return Array.from(materials);
}

function normalizeTrial(study) {
  const protocol = study?.protocolSection || {};
  const identification = protocol.identificationModule || {};
  const statusModule = protocol.statusModule || {};
  const designModule = protocol.designModule || {};
  const conditionsModule = protocol.conditionsModule || {};
  const armsInterventionsModule = protocol.armsInterventionsModule || {};
  const sponsorCollaboratorsModule = protocol.sponsorCollaboratorsModule || {};
  const contactsLocationsModule = protocol.contactsLocationsModule || {};
  const descriptionModule = protocol.descriptionModule || {};
  const eligibilityModule = protocol.eligibilityModule || {};
  const enrollmentInfoModule = protocol.enrollmentModule || {};

  const locations = contactsLocationsModule.locations || [];
  const interventions = armsInterventionsModule.interventions || [];
  const interventionTypes = interventions.map((item) => item?.type).filter(Boolean);
  const interventionNames = interventions.map((item) => item?.name).filter(Boolean);
  const suggestedMaterials = inferSuggestedMaterialsFromEligibility(
    eligibilityModule.eligibilityCriteria || '',
    identification.officialTitle || identification.briefTitle || '',
    conditionsModule.conditions || []
  );

  return {
    nctId: identification.nctId,
    title: identification.officialTitle || identification.briefTitle || '',
    status: statusModule.overallStatus || '',
    phase: designModule.phases || [],
    conditions: conditionsModule.conditions || [],
    studyType: designModule.studyType || '',
    interventionTypes,
    interventionNames,
    leadSponsor: sponsorCollaboratorsModule.leadSponsor?.name || '',
    primaryPurpose: designModule.designInfo?.primaryPurpose || '',
    observationalModel: designModule.designInfo?.observationalModel || '',
    timePerspective: designModule.designInfo?.timePerspective || '',
    allocation: designModule.designInfo?.allocation || '',
    masking: designModule.designInfo?.maskingInfo?.masking || '',
    enrollmentCount: enrollmentInfoModule.count || null,
    enrollmentType: enrollmentInfoModule.type || '',
    sex: eligibilityModule.sex || '',
    minimumAge: eligibilityModule.minimumAge || '',
    maximumAge: eligibilityModule.maximumAge || '',
    healthyVolunteers: eligibilityModule.healthyVolunteers || '',
    stdAges: eligibilityModule.stdAges || [],
    suggestedMaterials,
    locations: locations.map((l) => l.facility).filter(Boolean),
    regions: detectRegions(locations),
    summary: descriptionModule.briefSummary || '',
    eligibility: eligibilityModule.eligibilityCriteria || '',
    lastUpdate: statusModule.lastUpdatePostDateStruct?.date || ''
  };
}

async function getExistingTranslations(nctIds = []) {
  if (!Array.isArray(nctIds) || nctIds.length === 0) {
    return new Map();
  }

  const placeholders = nctIds.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT nct_id, title_zh, summary_zh, eligibility_zh FROM trials_cache WHERE nct_id IN (${placeholders})`,
    nctIds
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.nct_id, {
      titleZh: row.title_zh || '',
      summaryZh: row.summary_zh || '',
      eligibilityZh: row.eligibility_zh || ''
    });
  }
  return map;
}

async function translateTrialFields(trial, existingZh) {
  let titleZh = existingZh?.titleZh || '';
  let summaryZh = existingZh?.summaryZh || '';
  let eligibilityZh = existingZh?.eligibilityZh || '';

  // 仅在缓存缺失时调用翻译，避免重复请求
  if (!titleZh && trial.title) {
    titleZh = await translateToZh(trial.title);
  }
  if (!summaryZh && trial.summary) {
    summaryZh = await translateToZh(trial.summary);
  }
  if (!eligibilityZh && trial.eligibility) {
    eligibilityZh = await translateToZh(trial.eligibility);
  }

  return { titleZh, summaryZh, eligibilityZh };
}

async function fetchAndCacheTrials(pageSize = DEFAULT_PAGE_SIZE) {
  const query = encodeURIComponent('Duchenne Muscular Dystrophy');
  const statusFilter = 'RECRUITING|ENROLLING_BY_INVITATION|ACTIVE_NOT_RECRUITING';
  const url = `${CLINICAL_TRIALS_BASE_URL}?query.cond=${query}&filter.overallStatus=${statusFilter}&pageSize=${pageSize}`;

  console.log('=== 开始抓取并缓存临床试验 ===');
  const response = await axios.get(url, { timeout: 20000 });
  const studies = response?.data?.studies || [];
  const normalizedTrials = studies.map(normalizeTrial).filter((trial) => trial.nctId && trial.title);
  if (normalizedTrials.length === 0) {
    console.log('未抓取到可用试验数据');
    return 0;
  }

  const existingMap = await getExistingTranslations(normalizedTrials.map((t) => t.nctId));
  const translatedTrials = [];

  for (let i = 0; i < normalizedTrials.length; i += 1) {
    const trial = normalizedTrials[i];
    const existingZh = existingMap.get(trial.nctId);
    const { titleZh, summaryZh, eligibilityZh } = await translateTrialFields(trial, existingZh);
    translatedTrials.push({
      ...trial,
      titleZh,
      summaryZh,
      eligibilityZh
    });

    // 轻微限速，降低翻译 API 触发频率
    if (i < normalizedTrials.length - 1) {
      await sleep(250);
    }
  }

  await trialCacheService.batchSaveTrials(translatedTrials);
  console.log(`=== 临床试验抓取缓存完成，共 ${translatedTrials.length} 条 ===`);
  return translatedTrials.length;
}

async function fetchAndCacheTrialByNct(nctId, userId = null) {
  const cleanNctId = String(nctId || '').trim().toUpperCase();
  if (!/^NCT\d{8}$/.test(cleanNctId)) {
    throw new Error('NCT ID 格式不正确');
  }

  const url = `${CLINICAL_TRIALS_BASE_URL}?query.term=${encodeURIComponent(cleanNctId)}&pageSize=1`;
  const response = await axios.get(url, { timeout: 20000 });
  const studies = response?.data?.studies || [];
  const targetStudy = studies.find((study) => {
    const id = study?.protocolSection?.identificationModule?.nctId || '';
    return String(id).toUpperCase() === cleanNctId;
  });

  if (!targetStudy) {
    throw new Error('未找到对应试验');
  }

  const trial = normalizeTrial(targetStudy);
  const existingMap = await getExistingTranslations([trial.nctId]);
  const existingZh = existingMap.get(trial.nctId);
  const { titleZh, summaryZh, eligibilityZh } = await translateTrialFields(trial, existingZh);
  const translatedTrial = { ...trial, titleZh, summaryZh, eligibilityZh, createdByUserId: userId || null };

  await trialCacheService.saveCachedTrial(translatedTrial);
  return translatedTrial;
}

module.exports = {
  fetchAndCacheTrials,
  fetchAndCacheTrialByNct
};
