import { formatDate as localizedDate, t, translateText, contentText, getLocale } from '../i18n/runtime';
import React from 'react';
import { Article, ArticleType } from '../types';
import { BookOpen, Activity, FileText, FlaskConical, Star, Beaker, Tag } from 'lucide-react';

// 格式化日期为 YYYY年MM月DD日
const formatDate = (dateStr: string): string => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return localizedDate(date);
  } catch {
    return dateStr;
  }
};

interface ArticleCardProps {
  article: Article;
  onSelect: (article: Article) => void;
}

const TagBadge: React.FC<{ type: ArticleType }> = ({ type }) => {
  let colorClass = 'bg-gray-100 text-gray-700';
  let Icon = FileText;

  switch (type) {
    case ArticleType.CLINICAL_TRIAL:
      colorClass = 'bg-purple-100 text-purple-700 border border-purple-200';
      Icon = Activity;
      break;
    case ArticleType.GUIDELINE:
      colorClass = 'bg-green-100 text-green-700 border border-green-200';
      Icon = BookOpen;
      break;
    case ArticleType.RESEARCH:
      colorClass = 'bg-blue-100 text-blue-700 border border-blue-200';
      Icon = FlaskConical;
      break;
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass} mr-2 mb-1`}>
      <Icon className="w-3 h-3 mr-1" />
      {translateText(type)}
    </span>
  );
};

export const ArticleCard: React.FC<ArticleCardProps> = ({ article, onSelect }) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-200 p-4 sm:p-5 flex flex-col h-full min-w-0 overflow-hidden">
      <div className="mb-3 flex flex-wrap items-center">
        {article.tags.map(tag => <TagBadge key={tag} type={tag} />)}
        {article.impactFactor && article.impactFactor !== '未知' && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 mr-2 mb-1">
            IF {translateText(article.impactFactor)}
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto mt-1 whitespace-nowrap">{translateText(formatDate(article.publicationDate))}</span>
      </div>

      {/* 标签细分 */}
      {article.subTags && article.subTags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {article.subTags.map((st, i) => (
            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Tag className="w-2.5 h-2.5 mr-1" />{translateText(st)}
            </span>
          ))}
        </div>
      )}
      
      <h3 
        className="text-lg font-bold text-gray-900 leading-snug mb-2 line-clamp-2 hover:text-brand-600 transition-colors cursor-default break-words [overflow-wrap:anywhere]"
        title={translateText(contentText(article.title, article.titleZh))}
      >
        {translateText(contentText(article.title, article.titleZh))}
      </h3>

      {/* AI总结 */}
      {article.aiSummary && (
        <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mb-3 leading-relaxed">
          💡 {translateText(article.aiSummary)}
        </p>
      )}
      
      <p 
        className="text-sm text-gray-600 mb-4 line-clamp-3 flex-grow leading-relaxed cursor-default break-words [overflow-wrap:anywhere]"
        title={translateText(contentText(article.abstract, article.abstractZh) || "暂无摘要预览。")}
      >
        {translateText(contentText(article.abstract, article.abstractZh) || "暂无摘要预览。")}
      </p>

      {/* 研究阶段与患者相关性 */}
      {(article.researchStage || (article.matchPercent != null && article.matchPercent > 0)) && (
        <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
          {article.researchStage && (
            <span className="inline-flex items-center px-2 py-1 rounded-md bg-teal-50 text-teal-700 border border-teal-100 font-medium">
              <Beaker className="w-3 h-3 mr-1" />{translateText(article.researchStage)}
            </span>
          )}
          {article.matchPercent != null && article.matchPercent > 0 && (
            <span className={`ml-auto inline-flex items-center px-2 py-1 rounded-md font-medium border ${
              article.matchPercent >= 60 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              article.matchPercent >= 30 ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-gray-50 text-gray-600 border-gray-200'
            }`}>
              <Star className="w-3 h-3 mr-1" />{t("ui.patient.relevance")}{translateText(article.matchPercent)}%
            </span>
          )}
        </div>
      )}

      <div className="mt-auto pt-4 border-t border-gray-50 flex min-w-0 items-center justify-between gap-2">
        <span 
          className="min-w-0 text-xs text-gray-500 italic truncate max-w-[50%] cursor-default"
          title={translateText(`${article.journal} | 作者: ${article.authors?.join(', ') || '未知'}`)}
        >
            {translateText(article.journal)}
        </span>
        <button 
          onClick={() => onSelect(article)}
          className="inline-flex shrink-0 items-center justify-center px-3 sm:px-4 py-2 border border-transparent text-sm font-medium rounded-lg text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 shadow-sm"
        >
          {t("ui.read.and.ask")}</button>
      </div>
    </div>
  );
};
