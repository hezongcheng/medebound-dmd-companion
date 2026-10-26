const fs = require('node:fs');
const path = require('node:path');

// Frontend catalogs are the source of truth; ship these generated copies with server/.
function syncLocales() {
  const sourceDirectory = path.join(__dirname, '../i18n/locales');
  const destinationDirectory = path.join(__dirname, 'locales');
  const locales = ['zh-CN', 'en'];
  const catalogs = locales.map(locale => {
    const text = fs.readFileSync(path.join(sourceDirectory, `${locale}.json`), 'utf8');
    const catalog = JSON.parse(text);
    if (!catalog || Array.isArray(catalog) || typeof catalog !== 'object' ||
        !Object.values(catalog).every(value => typeof value === 'string' && value.trim())) {
      throw new Error(`Invalid locale catalog: ${locale}`);
    }
    return { locale, text, keys: Object.keys(catalog).sort() };
  });
  if (JSON.stringify(catalogs[0].keys) !== JSON.stringify(catalogs[1].keys)) {
    throw new Error('Locale catalogs must contain identical message keys');
  }
  fs.mkdirSync(destinationDirectory, { recursive: true });
  for (const { locale, text } of catalogs) {
    const destination = path.join(destinationDirectory, `${locale}.json`);
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== text) {
      fs.writeFileSync(destination, text, 'utf8');
    }
  }
}

if (require.main === module) {
  syncLocales();
  console.log('Server locale resources synchronized.');
}
module.exports = { syncLocales };
