import { t, translateText, contentText, getLocale } from '../i18n/runtime';

import React from 'react';
import { FDADrug, CHINA_STATUS_LABELS, CHINA_STATUS_COLORS, ChinaDrugStatus } from '../types';
import { ShieldCheck, Factory, Calendar, HeartPulse, ArrowRight, MapPin } from 'lucide-react';

interface Props {
  drug: FDADrug;
  onSelect: (drug: FDADrug) => void;
}

export const DrugCard: React.FC<Props> = ({ drug, onSelect }) => {
  const statusColor = CHINA_STATUS_COLORS[drug.chinaStatus || 'unknown'];
  const statusLabel = CHINA_STATUS_LABELS[drug.chinaStatus || 'unknown'];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:border-brand-300 hover:shadow-md transition-all flex flex-col h-full border-t-4 border-t-brand-500">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 bg-brand-50 rounded-lg shrink-0">
          <ShieldCheck className="w-6 h-6 text-brand-600" />
        </div>
        <div className="overflow-hidden">
          <h3 className="font-extrabold text-gray-900 text-lg leading-tight truncate">
            {translateText(drug.brandName)}
            {getLocale() === 'zh-CN' && drug.brandNameCn && drug.brandNameCn !== drug.brandName && (
              <span className="block text-sm font-medium text-gray-400 mt-0.5">{translateText(drug.brandNameCn)}</span>
            )}
          </h3>
        </div>
      </div>

      {/* 中国可用性状态标签 */}
      <div className="mb-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusColor}`}>
          <MapPin className="w-2.5 h-2.5" />
          {translateText(statusLabel)}
        </span>
      </div>

      <div className="space-y-2.5 text-sm text-gray-600 mb-6 flex-grow">
        <div className="flex items-center gap-2">
          <Factory className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="truncate">{translateText(drug.manufacturer)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
          <span>{t("ui.fda.approved")}{translateText(drug.approvalYear)}</span>
        </div>
        <div className="flex items-start gap-2 bg-brand-50/50 p-2.5 rounded-lg border border-brand-100 mt-2">
          <HeartPulse className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-brand-900 line-clamp-3">
            <span className="font-bold">{t("ui.indication")}</span> {translateText(contentText(drug.indication, drug.indicationZh))}
          </p>
        </div>
      </div>

      <p className="mb-3 text-xs text-teal-700">{t("ui.fda.adverse.event.reports.are.available.in.the.details")}</p>

      <button
        onClick={() => onSelect(drug)}
        className="mt-auto w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-bold hover:bg-brand-700 transition-all shadow-sm hover:shadow-brand-500/20"
      >
        {t("ui.drug.suitability")}<ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
};
