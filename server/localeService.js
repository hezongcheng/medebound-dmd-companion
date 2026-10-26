const { AsyncLocalStorage } = require('node:async_hooks');
const { isIP } = require('node:net');
const localeContext = new AsyncLocalStorage();
const SUPPORTED = ['zh-CN', 'en'];
// Bundle runtime resources inside server/ so server + dist deployments are self-contained.
const chineseMessages = require('./locales/zh-CN.json');
const englishMessages = require('./locales/en.json');
const translatedMessages = new Map(Object.entries(chineseMessages).map(([key, value]) => [value, englishMessages[key] || value]));
function localizeMessage(message, locale = getRequestLocale()) {
  if (locale !== 'en' || typeof message !== 'string') return message;
  if (translatedMessages.has(message)) return translatedMessages.get(message);
  for (const [prefix, translated] of [
    ['服务暂时不可用，请稍后再试。错误: ', 'Service temporarily unavailable. Please retry. Details: '],
    ['网络连接出现问题，请重试。错误: ', 'Connection error. Please retry. Details: ']
  ]) if (message.startsWith(prefix)) return translated + message.slice(prefix.length);
  return message;
}
let geoip;
let geoipUnavailable = false;
function countryForIP(ip) {
  const address = String(ip || '').replace(/^::ffff:/, '');
  if (!isIP(address)) return null;
  try {
    if (geoipUnavailable) return null;
    if (!geoip) geoip = require('geoip-lite');
    return geoip.lookup(address)?.country || null;
  } catch (error) {
    geoipUnavailable = true;
    console.warn('GeoIP database unavailable; falling back to browser language:', error.message);
    return null;
  }
}
function localeFromBrowser(header = '') {
  return String(header).split(',').map((item, index) => {
    const [language, ...options] = item.trim().split(';');
    const quality = options.find(value => value.trim().startsWith('q='));
    return { language: language.toLowerCase(), quality: quality ? Number(quality.trim().slice(2)) : 1, index };
  }).filter(item => item.quality > 0 && item.quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map(item => /^zh(?:-|$)/.test(item.language) ? 'zh-CN' : /^en(?:-|$)/.test(item.language) ? 'en' : null)
    .find(Boolean) || 'en';
}
function validPreference(value) {
  return Boolean(value && (value.mode === 'auto' && value.locale === null ||
    value.mode === 'manual' && SUPPORTED.includes(value.locale)));
}
const getRequestLocale = () => localeContext.getStore()?.locale || 'zh-CN';
function registerLocaleRoutes(app, pool, authenticateToken, lookup = countryForIP) {
  // Forwarded IPs are only used after Express validates the configured proxy chain.
  app.get('/api/locale', (req, res) => {
    const country = lookup(req.ip);
    const locale = country ? country === 'CN' ? 'zh-CN' : 'en' : localeFromBrowser(req.headers['accept-language']);
    res.set('Cache-Control', 'private, no-store');
    res.vary('Accept-Language');
    res.json({ locale, country: country || null, source: country ? 'ip' : 'browser' });
  });
  app.get('/api/user/language', authenticateToken, async (req, res) => {
    try {
      const [rows] = await pool.execute('SELECT language_mode, preferred_locale FROM user_language_preferences WHERE user_id = ?', [req.user.userId]);
      const row = rows[0];
      res.set('Cache-Control', 'private, no-store');
      res.json({ preference: row ? { mode: row.language_mode, locale: row.preferred_locale } : null });
    } catch { res.status(503).json({ code: 'LANGUAGE_UNAVAILABLE', error: 'Language settings are temporarily unavailable.' }); }
  });
  app.put('/api/user/language', authenticateToken, async (req, res) => {
    if (!validPreference(req.body)) return res.status(400).json({ code: 'INVALID_LANGUAGE', error: 'Invalid language preference.' });
    try {
      const { mode, locale } = req.body;
      await pool.execute(`INSERT INTO user_language_preferences (user_id, language_mode, preferred_locale)
        VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE language_mode = VALUES(language_mode), preferred_locale = VALUES(preferred_locale)`,
      [req.user.userId, mode, locale]);
      res.json({ preference: { mode, locale } });
    } catch { res.status(503).json({ code: 'LANGUAGE_UNAVAILABLE', error: 'Language settings could not be saved.' }); }
  });
}
function localeMiddleware(req, res, next) {
  const explicit = req.headers['x-app-locale'];
  const locale = SUPPORTED.includes(explicit) ? explicit : localeFromBrowser(req.headers['accept-language']);
  res.set('Content-Language', locale);
  const json = res.json.bind(res);
  res.json = body => {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      body = { ...body };
      for (const key of ['error', 'message']) if (typeof body[key] === 'string') body[key] = localizeMessage(body[key], locale);
      if (body.error && !body.code) body.code = res.statusCode >= 500 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_FAILED';
      if (Array.isArray(body.questions)) body.questions = body.questions.map(question => localizeMessage(question, locale));
    }
    return json(body);
  };
  localeContext.run({ locale }, next);
}
module.exports = { countryForIP, localeFromBrowser, validPreference, registerLocaleRoutes, localeMiddleware, getRequestLocale, localeContext, localizeMessage };
