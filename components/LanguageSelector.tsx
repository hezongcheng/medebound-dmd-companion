import React from 'react';
import { useLanguage } from '../i18n/LanguageProvider';
import { t } from '../i18n/runtime';

export function LanguageSelector() {
  const { preference, saving, error, changeLanguage } = useLanguage();
  return <section className="rounded-xl border border-gray-200 bg-white p-4 mb-5">
    <label htmlFor="language-choice" className="block text-sm font-semibold text-gray-800 mb-2">{t('language.label')}</label>
    <select id="language-choice" disabled={saving} value={preference.mode === 'auto' ? 'auto' : preference.locale}
      onChange={event => void changeLanguage(event.target.value === 'auto' ? { mode: 'auto', locale: null }
        : { mode: 'manual', locale: event.target.value as 'en' | 'zh-CN' })}
      className="w-full sm:w-auto border border-gray-300 rounded-lg p-2 text-sm bg-white text-gray-800 disabled:opacity-50">
      <option value="auto">{t('language.auto')}</option>
      <option value="zh-CN">简体中文</option>
      <option value="en">English</option>
    </select>
    <p className="mt-2 text-xs text-gray-500">{t('language.description')}</p>
    {saving && <p role="status" className="mt-2 text-xs text-gray-500">{t('language.saving')}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{t(error)}</p>}
  </section>;
}
