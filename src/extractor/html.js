/**
 * Extract product data from HTML using CSS selectors.
 *
 * @param {import('playwright').Page} page
 * @param {object} platformConfig - Platform-specific selector config
 * @returns {Promise<object>}
 */
export async function extractFromHtml(page, platformConfig) {
  const selectors = platformConfig.selectors || {};
  const result = {};

  // Product name
  const name = await trySelectorsText(page, selectors.productTitle || ['h1']);
  if (name) result.name = name;

  // Price
  const priceText = await trySelectorsText(page, selectors.price || []);
  const salePriceText = await trySelectorsText(page, selectors.salePrice || []);
  const currency = await trySelectorAttribute(page, selectors.currency || [], 'content')
    || await detectCurrencyFromText(page, selectors.price || []);

  if (priceText || salePriceText) {
    result.price = {};
    if (currency) result.price.currency = currency;

    if (salePriceText && priceText) {
      // If both exist, the "sale price" is usually the old/regular price
      // and "price" is the current/final price
      result.price.regular = parsePrice(salePriceText);
      result.price.final = parsePrice(priceText);
    } else if (priceText) {
      result.price.final = parsePrice(priceText);
    }
  }

  // Description
  const description = await trySelectorsHtml(page, selectors.description || []);
  if (description) result.description = description;

  // SKU
  const sku = await trySelectorsText(page, selectors.sku || [])
    || await trySelectorAttribute(page, ['[data-sku]'], 'data-sku');
  if (sku) result.sku = sku;

  // Brand
  const brand = await trySelectorsText(page, selectors.brand || [])
    || await trySelectorAttribute(page, ['meta[itemprop="brand"]', 'meta[property="product:brand"]'], 'content');
  if (brand) result.brand = brand;

  // Images
  const images = await extractImages(page, selectors.images || []);
  if (images.length) result.images = images;

  // Availability
  const availText = await trySelectorsText(page, selectors.availability || [])
    || await trySelectorAttribute(page, ['[itemprop="availability"]', 'link[itemprop="availability"]'], 'content')
    || await trySelectorAttribute(page, ['[itemprop="availability"]', 'link[itemprop="availability"]'], 'href');
  if (availText) result.availability = availText;

  // Meta title and description
  const metaTitle = await page.$eval('title', (el) => el.textContent?.trim()).catch(() => null);
  if (metaTitle) result.metaTitle = metaTitle;

  const metaDesc = await trySelectorAttribute(page, ['meta[name="description"]', 'meta[property="og:description"]'], 'content');
  if (metaDesc) result.metaDescription = metaDesc;

  return result;
}

/**
 * Try multiple selectors, return the text content of the first match.
 */
async function trySelectorsText(page, selectors) {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        const text = await el.textContent();
        const trimmed = text?.trim();
        if (trimmed) return trimmed;
      }
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Try multiple selectors, return innerHTML of the first match.
 */
async function trySelectorsHtml(page, selectors) {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        const html = await el.innerHTML();
        if (html?.trim()) return html.trim();
      }
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Try to get an attribute value from the first matching selector.
 */
async function trySelectorAttribute(page, selectors, attribute) {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        const val = await el.getAttribute(attribute);
        if (val?.trim()) return val.trim();
      }
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Detect currency from price text (symbol-based).
 */
async function detectCurrencyFromText(page, selectors) {
  const text = await trySelectorsText(page, selectors);
  if (!text) return null;
  return currencyFromSymbol(text);
}

const CURRENCY_SYMBOLS = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₩': 'KRW',
  'R$': 'BRL',
  'kr': 'SEK',
  'CHF': 'CHF',
  'A$': 'AUD',
  'C$': 'CAD',
};

function currencyFromSymbol(text) {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  return null;
}

/**
 * Parse a price string into a clean numeric string.
 * Handles formats like $99.99, 99,99 €, 1,299.00, etc.
 */
export function parsePrice(text) {
  if (!text) return undefined;

  // Remove currency symbols and whitespace
  let cleaned = text.replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) return undefined;

  // Handle European format (1.234,56 → 1234.56)
  if (/^\d{1,3}(\.\d{3})*(,\d{2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  // Handle format with comma as thousands separator (1,234.56)
  else if (/^\d{1,3}(,\d{3})*(\.\d{2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, '');
  }
  // Simple comma decimal (99,99)
  else if (/^\d+,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(',', '.');
  }

  // Validate it's a number
  const num = parseFloat(cleaned);
  if (Number.isNaN(num)) return undefined;

  return cleaned;
}

/**
 * Extract images from the page.
 */
async function extractImages(page, selectors) {
  const urls = new Set();
  const images = [];

  for (const selector of selectors) {
    try {
      const elements = await page.$$(selector);
      for (const el of elements) {
        const src = await el.getAttribute('src')
          || await el.getAttribute('data-src')
          || await el.getAttribute('data-srcset')?.then((s) => s?.split(' ')[0]);

        if (!src) continue;

        try {
          const fullUrl = new URL(src, page.url()).href;
          // Skip data URIs, SVGs, tracking pixels
          if (fullUrl.startsWith('data:')) continue;
          if (fullUrl.includes('.svg')) continue;
          if (fullUrl.includes('pixel') || fullUrl.includes('tracking')) continue;

          if (!urls.has(fullUrl)) {
            urls.add(fullUrl);
            const alt = await el.getAttribute('alt');
            images.push({
              url: fullUrl,
              ...(alt ? { label: alt } : {}),
            });
          }
        } catch { /* ignore invalid URLs */ }
      }
    } catch { /* ignore */ }
  }

  return images;
}
