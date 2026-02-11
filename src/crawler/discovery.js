import fs from 'node:fs';
import { fetchRobotsTxt, isAllowed } from './robots.js';
import { parseSitemap, filterProductUrls, COMMON_SITEMAP_URLS } from './sitemap.js';
import { discoverFromCategory } from './category.js';

/**
 * Discover product URLs using the configured mode.
 *
 * @param {import('./browser.js').BrowserManager} browserManager
 * @param {{
 *   url: string,
 *   mode: 'sitemap'|'category'|'urls',
 *   urlsFile?: string,
 *   platform?: string,
 *   maxProducts?: number,
 *   logger?: object,
 * }} options
 * @returns {Promise<string[]>}
 */
export async function discoverProducts(browserManager, options) {
  const { url, mode, urlsFile, platform = 'generic', maxProducts, logger } = options;

  let urls = [];

  switch (mode) {
    case 'sitemap':
      urls = await discoverFromSitemap(url, platform, logger);
      break;
    case 'category':
      urls = await discoverFromCategoryPages(browserManager, url, platform, logger);
      break;
    case 'urls':
      urls = loadUrlsFromFile(urlsFile, logger);
      break;
    default:
      throw new Error(`Unknown discovery mode: ${mode}`);
  }

  // Deduplicate
  urls = [...new Set(urls)];

  // Apply max limit
  if (maxProducts && urls.length > maxProducts) {
    urls = urls.slice(0, maxProducts);
  }

  return urls;
}

/**
 * Discover products via sitemap parsing.
 */
async function discoverFromSitemap(baseUrl, platform, logger) {
  if (logger) logger.info('Fetching robots.txt...');

  const robots = await fetchRobotsTxt(baseUrl);
  let sitemapUrls = robots.sitemaps;

  if (sitemapUrls.length === 0) {
    if (logger) logger.info('No sitemaps in robots.txt, trying common locations...');
    const base = new URL(baseUrl).origin;
    for (const path of COMMON_SITEMAP_URLS) {
      const candidate = `${base}${path}`;
      if (logger) logger.debug(`Trying sitemap: ${candidate}`);
      // eslint-disable-next-line no-await-in-loop
      const urls = await parseSitemap(candidate);
      if (urls.length > 0) {
        sitemapUrls.push(candidate);
        if (logger) logger.success(`Found sitemap: ${candidate} (${urls.length} URLs)`);
        break;
      }
    }
  }

  if (sitemapUrls.length === 0) {
    if (logger) logger.warn('No sitemaps found. Try using --mode category instead.');
    return [];
  }

  if (logger) logger.info(`Parsing ${sitemapUrls.length} sitemap(s)...`);

  const allUrls = [];
  for (const smUrl of sitemapUrls) {
    if (logger) logger.debug(`Parsing: ${smUrl}`);
    // eslint-disable-next-line no-await-in-loop
    const urls = await parseSitemap(smUrl);
    allUrls.push(...urls);
  }

  if (logger) logger.info(`Found ${allUrls.length} total URLs in sitemaps`);

  // Filter for product URLs
  const productUrls = filterProductUrls(allUrls, { platform });
  if (logger) logger.info(`Filtered to ${productUrls.length} product URLs`);

  // Filter by robots.txt rules
  const allowedUrls = productUrls.filter((u) => isAllowed(u, robots));
  if (allowedUrls.length < productUrls.length && logger) {
    logger.info(`${productUrls.length - allowedUrls.length} URLs blocked by robots.txt`);
  }

  return allowedUrls;
}

/**
 * Discover products by crawling category pages.
 */
async function discoverFromCategoryPages(browserManager, startUrl, platform, logger) {
  if (logger) logger.info(`Crawling category pages starting from: ${startUrl}`);
  const page = await browserManager.newPage({ blockImages: true });
  try {
    const urls = await discoverFromCategory(page, startUrl, { platform, logger });
    if (logger) logger.info(`Discovered ${urls.length} product URLs from category pages`);
    return urls;
  } finally {
    await page.close();
  }
}

/**
 * Load URLs from a file (one per line).
 */
function loadUrlsFromFile(filePath, logger) {
  if (!filePath) throw new Error('--urls-file is required when using --mode urls');
  if (!fs.existsSync(filePath)) throw new Error(`URLs file not found: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const urls = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (logger) logger.info(`Loaded ${urls.length} URLs from ${filePath}`);
  return urls;
}
