import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserLocale, resolveLocale, validPreference } from './preferences.mjs';
test('manual choices survive IP changes; auto uses detected locale', () => {
  assert.equal(resolveLocale({ mode: 'manual', locale: 'en' }, 'zh-CN'), 'en');
  assert.equal(resolveLocale({ mode: 'manual', locale: 'zh-CN' }, 'en'), 'zh-CN');
  assert.equal(resolveLocale({ mode: 'auto', locale: null }, 'zh-CN'), 'zh-CN');
  assert.equal(resolveLocale({ mode: 'manual', locale: 'ja' }, 'en'), 'en');
});
test('browser fallback handles regional languages and unsupported values', () => {
  assert.equal(browserLocale(['ja', 'zh-TW']), 'zh-CN');
  assert.equal(browserLocale(['en-GB', 'zh']), 'en');
  assert.equal(browserLocale(['ja']), 'en');
  assert.equal(validPreference({ mode: 'auto', locale: 'zh-CN' }), false);
});
