import zh from './locales/zh-CN.json';
import en from './locales/en.json';
import { DEFAULT_LOCALE } from './preferences.mjs';

export type Locale = 'zh-CN' | 'en';
export type LanguagePreference = { mode: 'auto'; locale: null } | { mode: 'manual'; locale: Locale };
export type MessageKey = keyof typeof zh;
const catalogs: Record<Locale, Record<string, string>> = { 'zh-CN': zh, en };
let currentLocale: Locale = DEFAULT_LOCALE as Locale;
const listeners = new Set<() => void>();
export const getLocale = () => currentLocale;
export const subscribeLocale = (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; };
export function setLocale(locale: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  if (currentLocale === locale) return;
  currentLocale = locale;
  listeners.forEach(callback => callback());
}
export function t(key: MessageKey | string, parameters: Record<string, unknown> = {}): string {
  const template = catalogs[currentLocale][key] || en[key] || zh[key] || key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : match);
}
export function plural(key: string, count: number): string {
  const category = new Intl.PluralRules(currentLocale).select(count);
  const specificKey = `${key}.${category}`;
  return t(catalogs[currentLocale][specificKey] ? specificKey : `${key}.other`, { count });
}

// Legacy labels remain unchanged in stored profiles and filtering logic.
// Translate them only when a component renders a string.
const labelKeys = new Map(Object.entries(zh).map(([key, value]) => [value, key]));
const patterns = Object.entries(zh).filter(([, text]) => /\{p\d+\}/.test(text)).map(([key, text]) => ({
  key,
  regex: new RegExp('^' + text.replace(/\s+/g, ' ').split(/(\{p\d+\})/).map(part =>
    /^\{p\d+\}$/.test(part) ? ['{p0}期', '早期{p0}期', '{p0}岁', '{p0}年'].includes(text) ? '(\\d+(?:\\.\\d+)?)' : '([\\s\\S]*?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$'),
  names: text.match(/p\d+(?=\})/g) || []
}));
export function translateText<T>(value: T): T {
  if (typeof value !== 'string' || currentLocale === 'zh-CN') return value;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const key = labelKeys.get(trimmed);
  if (key) return value.replace(value.trim(), t(key)) as T;
  if (/ \/ |；|、/.test(value)) {
    const parts = value.split(/( \/ |；|、)/);
    const translated = parts.map(part => labelKeys.has(part) ? t(labelKeys.get(part)!) : part);
    if (translated.some((part, index) => part !== parts[index])) return translated.join('') as T;
  }
  for (const pattern of patterns) {
    const match = pattern.regex.exec(trimmed);
    if (match) return t(pattern.key, Object.fromEntries(pattern.names.map((name, i) => [name, match[i + 1]]))) as T;
  }
  return value;
}
export const contentText = (original?: string | null, chinese?: string | null): string =>
  currentLocale === 'zh-CN' ? chinese || original || '' : original || chinese || '';
export function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(currentLocale, {
    year: 'numeric', month: 'short', day: 'numeric'
  }).format(date);
}
