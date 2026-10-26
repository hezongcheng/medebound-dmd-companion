import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { API_BASE, TOKEN_KEY, USER_KEY } from '../services/apiClient';
import { browserLocale, validPreference, resolveLocale } from './preferences.mjs';
import { getLocale, setLocale, subscribeLocale, t, type LanguagePreference, type Locale } from './runtime';

const STORAGE_KEY = 'hanzhi_language_preference_v1';
const AUTO: LanguagePreference = { mode: 'auto', locale: null };
function readPreference(): LanguagePreference {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return validPreference(value) ? value : AUTO;
  } catch { return AUTO; }
}
function persist(value: LanguagePreference) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* private mode */ }
}
const initialPreference = readPreference();
const initialAutomaticLocale = browserLocale(Array.from(navigator.languages || [navigator.language])) as Locale;
setLocale(resolveLocale(initialPreference, initialAutomaticLocale) as Locale);

const Context = createContext<{
  preference: LanguagePreference;
  saving: boolean;
  error: string;
  changeLanguage: (value: LanguagePreference) => Promise<void>;
}>({ preference: AUTO, saving: false, error: '', changeLanguage: async () => {} });

async function request(endpoint: string, token?: string | null, body?: LanguagePreference) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      signal: controller.signal,
      method: body ? 'PUT' : 'GET',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': getLocale(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error('Language request failed');
    return await response.json();
  } finally { clearTimeout(timeout); }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState(initialPreference);
  const preferenceRef = useRef(initialPreference);
  const automaticLocale = useRef<Locale>(initialAutomaticLocale);
  const generation = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  const apply = (value: LanguagePreference) => {
    preferenceRef.current = value;
    setPreference(value);
    persist(value);
    setLocale(resolveLocale(value, automaticLocale.current) as Locale);
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('app.title');
  }, [locale]);

  useEffect(() => {
    let disposed = false;
    let identity: string | null | undefined;
    const synchronize = async () => {
      const token = localStorage.getItem(TOKEN_KEY);
      const user = localStorage.getItem(USER_KEY);
      const nextIdentity = token && user ? `${user}:${token}` : null;
      if (identity === nextIdentity) return;
      identity = nextIdentity;
      const revision = ++generation.current;
      setError('');
      if (!token || !user) return; // Retain the current browser language after logout.
      try {
        const result = await request('/api/user/language', token);
        if (disposed || revision !== generation.current) return;
        if (validPreference(result.preference)) apply(result.preference);
        else if (preferenceRef.current.mode === 'manual') {
          await request('/api/user/language', token, preferenceRef.current);
        }
      } catch {
        if (!disposed && revision === generation.current) setError('language.syncFailed');
      }
    };
    void synchronize();
    // Existing authentication includes a WeChat redirect and direct localStorage writes.
    const timer = window.setInterval(() => void synchronize(), 500);
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        generation.current++;
        apply(readPreference());
      }
      void synchronize();
    };
    window.addEventListener('storage', onStorage);
    return () => { disposed = true; generation.current++; clearInterval(timer); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    let active = true;
    request('/api/locale').then(result => {
      if (!active || !['zh-CN', 'en'].includes(result.locale)) return;
      automaticLocale.current = result.locale;
      setLocale(resolveLocale(preferenceRef.current, result.locale) as Locale);
    }).catch(() => {}); // Browser language remains available when the API is offline.
    return () => { active = false; };
  }, []);

  const changeLanguage = async (value: LanguagePreference) => {
    if (!validPreference(value) || saving) return;
    const revision = ++generation.current;
    const previous = preferenceRef.current;
    const token = localStorage.getItem(TOKEN_KEY);
    setError('');
    apply(value);
    if (!token) return;
    setSaving(true);
    try { await request('/api/user/language', token, value); }
    catch {
      if (revision === generation.current) { apply(previous); setError('language.saveFailed'); }
    } finally { setSaving(false); }
  };
  return <Context.Provider value={{ preference, saving, error, changeLanguage }}>
    {children}
  </Context.Provider>;
}
export function useLanguage() {
  const context = useContext(Context);
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  return { ...context, locale };
}
