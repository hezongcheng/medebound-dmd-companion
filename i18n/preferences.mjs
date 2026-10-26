export const SUPPORTED_LOCALES = ['zh-CN', 'en'];
export const DEFAULT_LOCALE = 'en';
export function normalizeLocale(value) {
  const base = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (base === 'zh' || base.startsWith('zh-')) return 'zh-CN';
  if (base === 'en' || base.startsWith('en-')) return 'en';
  return null;
}
export function browserLocale(languages = []) {
  for (const language of languages) {
    const locale = normalizeLocale(language);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
export function validPreference(value) {
  return Boolean(value && (value.mode === 'auto' && value.locale === null ||
    value.mode === 'manual' && SUPPORTED_LOCALES.includes(value.locale)));
}
export function resolveLocale(preference, automaticLocale) {
  return validPreference(preference) && preference.mode === 'manual'
    ? preference.locale : normalizeLocale(automaticLocale) || DEFAULT_LOCALE;
}
