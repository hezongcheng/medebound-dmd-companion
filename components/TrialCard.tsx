import { t, translateText, contentText, getLocale } from '../i18n/runtime';
﻿import React from 'react';
import { ClinicalTrial } from '../types';
import { MapPin, Info, ClipboardCheck, ArrowRight, Globe } from 'lucide-react';

interface Props {
  trial: ClinicalTrial;
  onSelect: (trial: ClinicalTrial) => void;
}

const STUDY_TYPE_LABELS: Record<string, string> = {
  INTERVENTIONAL: '干预性研究',
  OBSERVATIONAL: '观察性研究',
  EXPANDED_ACCESS: '拓展用药',
};

const INTERVENTION_TYPE_LABELS: Record<string, string> = {
  DRUG: '药物',
  BIOLOGICAL: '生物制品',
  DEVICE: '医疗器械',
  PROCEDURE: '操作治疗',
  BEHAVIORAL: '行为干预',
  DIETARY_SUPPLEMENT: '膳食补充剂',
  DIAGNOSTIC_TEST: '诊断检查',
  RADIATION: '放射治疗',
  GENETIC: '基因干预',
  OTHER: '其他干预',
};

const safeLabel = (value?: string, map?: Record<string, string>) => {
  if (!value) return '';
  const key = String(value).trim().toUpperCase();
  return map?.[key] || value;
};

const uniqueNonEmpty = (items: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const text = String(item || '').trim();
    if (!text) continue;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(text);
  }
  return result;
};

const uniqueListText = (items: string[], sep = ' / '): string => uniqueNonEmpty(items).join(sep);

const detectTrialTypeFallback = (trial: ClinicalTrial): '患者登记' | '治疗性试验' | '观察性研究' => {
  const studyType = String(trial.studyType || '').toUpperCase();
  const primaryPurpose = String(trial.primaryPurpose || '').toUpperCase();
  if (studyType === 'OBSERVATIONAL') {
    if (primaryPurpose === 'PATIENT_REGISTRY') return '患者登记';
    return '观察性研究';
  }
  if (studyType === 'INTERVENTIONAL') {
    return '治疗性试验';
  }

  const text = `${contentText(trial.title, trial.titleZh) || ''} ${trial.summary || ''} ${(trial.conditions || []).join(' ')}`.toLowerCase();
  if (text.includes('registry') || text.includes('登记')) return '患者登记';
  if ((trial.phase || []).length > 0) return '治疗性试验';
  return '观察性研究';
};

export const TrialCard: React.FC<Props> = ({ trial, onSelect }) => {
  const isRecruiting = String(trial.status || '').toLowerCase().includes('recruiting');
  const displayStatus = isRecruiting ? '正在招募' : '活跃未招募';

  const fallbackType = detectTrialTypeFallback(trial);
  const studyTypeLabel = safeLabel(trial.studyType, STUDY_TYPE_LABELS) || fallbackType;
  const interventionLabels = uniqueNonEmpty(
    (trial.interventionTypes || [])
      .map((item) => safeLabel(item, INTERVENTION_TYPE_LABELS))
      .filter(Boolean) as string[]
  );
  const interventionLabel = interventionLabels.length > 0
    ? uniqueListText(interventionLabels, ' / ')
    : (fallbackType === '治疗性试验' ? '干预类型待补充' : '非用药/观察');

  const regionList = uniqueNonEmpty((trial.regions || []).map(String));
  const regionText = regionList.length > 0 ? regionList.join(' / ') : '全球';
  const phaseList = uniqueNonEmpty((trial.phase || []).map(String));
  const phaseText = phaseList.length > 0 ? phaseList.join(', ') : 'N/A';
  const siteList = uniqueNonEmpty((trial.locations || []).map(String));
  const siteText = siteList.length > 0 ? `${siteList[0]} 等 ${siteList.length} 个中心` : '全球多中心';

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all p-3.5 md:p-4.5 flex flex-col h-full border-l-4 border-l-emerald-500">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className={`text-[11px] font-bold px-3 py-1 rounded-full ${
            isRecruiting ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
          }`}
        >
          {translateText(displayStatus)}
        </span>
        <span className="text-xs text-gray-400 font-mono truncate" title={translateText(trial.nctId)}>{translateText(trial.nctId)}</span>
      </div>

      <h3 className="text-base md:text-lg font-bold text-gray-900 leading-6 md:leading-7 line-clamp-2 h-12 md:h-14 overflow-hidden" title={translateText(contentText(trial.title, trial.titleZh))}>
        {translateText(contentText(trial.title, trial.titleZh))}
      </h3>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-100" title={translateText(studyTypeLabel)}>
          {translateText(studyTypeLabel)}
        </span>
        <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border bg-sky-50 text-sky-700 border-sky-100" title={translateText(interventionLabel)}>
          {translateText(interventionLabel)}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-1 text-xs text-gray-600 flex-grow">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <span className="truncate" title={translateText(regionText)}>{translateText(regionText)}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <Info className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <span className="truncate" title={translateText(`阶段: ${phaseText}`)}>{t("ui.phase")}{translateText(phaseText)}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <span className="truncate" title={translateText(siteText)}>{t("ui.sites")}{translateText(siteText)}</span>
        </div>
      </div>

      <button
        onClick={() => onSelect(trial)}
        className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-bold hover:bg-emerald-100 transition-colors"
      >
        <ClipboardCheck className="w-4 h-4" />
        {t("ui.eligibility.analysis")}<ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};
