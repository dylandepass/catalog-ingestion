import { parseStringPromise } from 'xml2js';

/**
 * Common product URL patterns by platform.
 */
const DEFAULT_PRODUCT_PATTERNS = [
  '/product/', '/products/', '/shop/', '/p/', '/dp/',
  '/catalog/product/', '/item/', '/goods/',
];

const PLATFORM_PATTERNS = {
  shopify: ['/products/'],
  magento: ['/catalog/product/', '.html'],
  bigcommerce: ['/products/'],
  woocommerce: ['/product/'],
};

/**
 * Parse an XML sitemap or sitemap index.
 * Recursively resolves sitemap indexes.
 *
 * @param {string} url
 * @param {{ maxDepth?: number }} [options]
 * @returns {Promise<string[]>} List of URLs found
 */
export async function parseSitemap(url, options = {}) {
  const { maxDepth = 3 } = options;
  if (maxDepth <= 0) return [];

  let xml;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CatalogIngestion/1.0)' },
    });
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }

  let parsed;
  try {
    parsed = await parseStringPromise(xml, { explicitArray: false });
  } catch {
    return [];
  }

  // Sitemap index — recurse into each child sitemap
  if (parsed.sitemapindex?.sitemap) {
    const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
      ? parsed.sitemapindex.sitemap
      : [parsed.sitemapindex.sitemap];

    const results = [];
    for (const sm of sitemaps) {
      const loc = sm.loc || sm;
      if (typeof loc === 'string') {
        // eslint-disable-next-line no-await-in-loop
        const childUrls = await parseSitemap(loc, { maxDepth: maxDepth - 1 });
        results.push(...childUrls);
      }
    }
    return results;
  }

  // URL set — extract URLs
  if (parsed.urlset?.url) {
    const urls = Array.isArray(parsed.urlset.url)
      ? parsed.urlset.url
      : [parsed.urlset.url];

    return urls
      .map((entry) => entry.loc || entry)
      .filter((loc) => typeof loc === 'string');
  }

  return [];
}

/**
 * Filter URLs that look like product pages.
 * @param {string[]} urls
 * @param {{ platform?: string, customPatterns?: string[] }} [options]
 * @returns {string[]}
 */
export function filterProductUrls(urls, options = {}) {
  const { platform, customPatterns = [] } = options;

  const patterns = [
    ...customPatterns,
    ...(platform && PLATFORM_PATTERNS[platform] ? PLATFORM_PATTERNS[platform] : DEFAULT_PRODUCT_PATTERNS),
  ];

  return urls.filter((url) => {
    const lower = url.toLowerCase();
    return patterns.some((pattern) => lower.includes(pattern));
  });
}

/**
 * Common sitemap locations to try if robots.txt doesn't list any.
 */
export const COMMON_SITEMAP_URLS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-products.xml',
  '/product-sitemap.xml',
  '/sitemap_products_1.xml',
];
