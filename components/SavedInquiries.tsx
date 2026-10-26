import { t, translateText, contentText, getLocale } from '../i18n/runtime';
import React, { useState } from 'react';
import { SavedInquiry, InquiryType } from '../types';
import { MessageSquare, Calendar, ChevronRight, ChevronDown, FileText, FlaskConical, Pill } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Props {
    inquiries: SavedInquiry[];
}

type TabType = 'all' | InquiryType;

const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'all', label: '全部', icon: null },
    { key: 'article', label: '文献', icon: <FileText className="w-4 h-4" /> },
    { key: 'trial', label: '实验', icon: <FlaskConical className="w-4 h-4" /> },
    { key: 'drug', label: '药物', icon: <Pill className="w-4 h-4" /> },
];

export const SavedInquiries: React.FC<Props> = ({ inquiries }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('all');

    // 过滤咨询记录
    const filteredInquiries = activeTab === 'all' 
        ? inquiries 
        : inquiries.filter(i => i.type === activeTab || (!i.type && activeTab === 'article'));

    // 统计各类型数量
    const getCounts = () => {
        const counts = { all: inquiries.length, article: 0, trial: 0, drug: 0 };
        inquiries.forEach(i => {
            const type = i.type || 'article';
            counts[type]++;
        });
        return counts;
    };
    const counts = getCounts();

    if (inquiries.length === 0) {
        return (
            <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
                <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900">{t("ui.no.saved.consultations")}</h3>
                <p className="text-gray-500 mt-2">{t("ui.select.save.consultation.while.reading.an.article.to.find")}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                <MessageSquare className="w-6 h-6 mr-2 text-brand-600" />
                {t("ui.saved.consultations")}</h2>

            {/* 分类标签 - 手机端自适应 */}
            <div className="grid grid-cols-4 sm:flex gap-1.5 sm:gap-2 mb-6 border-b border-gray-200 pb-4">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 px-2 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                            activeTab === tab.key
                                ? 'bg-brand-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                        <span className="hidden sm:inline-flex">{translateText(tab.icon)}</span>
                        {translateText(tab.label)}
                        <span className={`ml-0.5 sm:ml-1 px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-xs ${
                            activeTab === tab.key ? 'bg-white/20' : 'bg-gray-200'
                        }`}>
                            {translateText(counts[tab.key])}
                        </span>
                    </button>
                ))}
            </div>

            {filteredInquiries.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl">
                    <p className="text-gray-500">{t("ui.no.consultations.in.this.category")}</p>
                </div>
            ) : (
                filteredInquiries.map((inquiry) => (
                    <div key={inquiry.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <button 
                            onClick={() => setExpandedId(expandedId === inquiry.id ? null : inquiry.id)}
                            className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors text-left"
                        >
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    {inquiry.type === 'trial' && <FlaskConical className="w-4 h-4 text-purple-500" />}
                                    {inquiry.type === 'drug' && <Pill className="w-4 h-4 text-green-500" />}
                                    {(!inquiry.type || inquiry.type === 'article') && <FileText className="w-4 h-4 text-blue-500" />}
                                    <h3 className="font-bold text-gray-900 line-clamp-1">{translateText(inquiry.articleTitle)}</h3>
                                </div>
                                <div className="flex items-center text-sm text-gray-500 mt-2 gap-4">
                                    <span className="flex items-center">
                                        <Calendar className="w-4 h-4 mr-1" />
                                        {translateText(inquiry.date)}
                                    </span>
                                    <span className="bg-brand-50 text-brand-700 px-2 py-0.5 rounded text-xs">
                                        {translateText(inquiry.chatHistory.length)} {t("ui.messages")}</span>
                                </div>
                            </div>
                            {expandedId === inquiry.id ? <ChevronDown className="text-gray-400" /> : <ChevronRight className="text-gray-400" />}
                        </button>
                        
                        {expandedId === inquiry.id && (
                            <div className="border-t border-gray-100 bg-gray-50 p-6 space-y-6">
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">{t("ui.ai.summary.review")}</h4>
                                    <div className="bg-white p-4 rounded-lg border border-gray-200 text-sm text-gray-700 prose prose-sm max-w-none">
                                        <ReactMarkdown>{translateText(inquiry.summary)}</ReactMarkdown>
                                    </div>
                                </div>
                                
                                <div>
                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">{t("ui.conversation")}</h4>
                                    <div className="space-y-3">
                                        {inquiry.chatHistory.map((msg, idx) => (
                                            <div key={idx} className={`p-3 rounded-lg text-sm ${
                                                msg.role === 'user' 
                                                ? 'bg-gray-800 text-white ml-8' 
                                                : 'bg-white border border-gray-200 text-gray-700 mr-8'
                                            }`}>
                                                <span className="block text-xs opacity-50 mb-1">{translateText(msg.role === 'user' ? '我' : 'AI 助手')}</span>
                                                <ReactMarkdown>{translateText(msg.text)}</ReactMarkdown>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    );
};