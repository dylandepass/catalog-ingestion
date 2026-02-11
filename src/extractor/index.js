import { extractJsonLd } from './jsonld.js';
import { extractFromHtml } from './html.js';
import { extractVariants } from './variants.js';

/**
 * Extract product data from a single page.
 * Tries JSON-LD first, supplements with HTML extraction.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {object} platformConfig
 * @param {{ logger?: object }} [options]
 * @returns {Promise<object|null>} Extracted product data or null on failure
 */
export async function extractProduct(page, url, platformConfig, options = {}) {
  const { logger } = options;

  // Navigate to the product page
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Wait a bit for dynamic content to render
    await page.waitForTimeout(1500);
  } catch (err) {
    if (logger) logger.warn(`Failed to load: ${url} — ${err.message}`);
    return null;
  }

  // Check for error pages (404, etc.)
  const status = await page.evaluate(() => {
    const title = document.title?.toLowerCase() || '';
    const body = document.body?.textContent?.toLowerCase() || '';
    if (title.includes('404') || title.includes('not found')) return 404;
    if (body.includes('page not found') && body.length < 1000) return 404;
    return 200;
  });

  if (status === 404) {
    if (logger) logger.debug(`Page appears to be 404: ${url}`);
    return null;
  }

  // Extract from JSON-LD
  let jsonldData = null;
  try {
    jsonldData = await extractJsonLd(page);
    if (jsonldData && logger) {
      logger.debug(`JSON-LD extracted for: ${url}`);
    }
  } catch (err) {
    if (logger) logger.debug(`JSON-LD extraction failed: ${err.message}`);
  }

  // Extract from HTML
  let htmlData = {};
  try {
    htmlData = await extractFromHtml(page, platformConfig);
    if (Object.keys(htmlData).length > 0 && logger) {
      logger.debug(`HTML extracted ${Object.keys(htmlData).length} fields for: ${url}`);
    }
  } catch (err) {
    if (logger) logger.debug(`HTML extraction failed: ${err.message}`);
  }

  // Merge: JSON-LD is primary, HTML fills gaps
  const merged = mergeProductData(jsonldData, htmlData);

  if (!merged.name && !merged.sku) {
    if (logger) logger.warn(`No product data found on: ${url}`);
    return null;
  }

  // Store the source URL
  merged.sourceUrl = url;

  // Extract variants
  try {
    const variants = await extractVariants(page, platformConfig, merged);
    if (variants.length > 0) {
      merged.variants = variants;
      if (logger) logger.debug(`Found ${variants.length} variants for: ${url}`);
    }
  } catch (err) {
    if (logger) logger.debug(`Variant extraction failed: ${err.message}`);
  }

  return merged;
}

/**
 * Merge JSON-LD and HTML extraction results.
 * JSON-LD takes priority; HTML fills in missing fields.
 * Arrays (images) are merged and deduplicated.
 */
function mergeProductData(jsonldData, htmlData) {
  if (!jsonldData && !htmlData) return {};
  if (!jsonldData) return { ...htmlData };
  if (!htmlData) return { ...jsonldData };

  const merged = { ...htmlData };

  // Overwrite with JSON-LD values (they're more reliable)
  for (const [key, value] of Object.entries(jsonldData)) {
    if (value === undefined || value === null) continue;
    if (key === 'images') continue; // Handle separately
    if (key === 'price' && merged.price) {
      // Merge price objects
      merged.price = { ...merged.price, ...value };
    } else {
      merged[key] = value;
    }
  }

  // Merge images: JSON-LD first, then HTML, deduplicate
  const jsonImages = jsonldData.images || [];
  const htmlImages = htmlData.images || [];
  const seenUrls = new Set();
  const allImages = [];

  for (const img of [...jsonImages, ...htmlImages]) {
    if (img.url && !seenUrls.has(img.url)) {
      seenUrls.add(img.url);
      allImages.push(img);
    }
  }
  if (allImages.length > 0) {
    merged.images = allImages;
  }

  return merged;
}
