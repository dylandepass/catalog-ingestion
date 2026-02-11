const PLATFORM_SELECTORS = {
  shopify: {
    productLinks: ['a[href*="/products/"]'],
    nextPage: ['a.pagination__next', '.pagination a[rel="next"]', 'a[rel="next"]'],
  },
  magento: {
    productLinks: ['.product-item-link', 'a.product-item-photo', '.product-item a[href]'],
    nextPage: ['a.action.next', '.pages-item-next a', 'a[rel="next"]'],
  },
  bigcommerce: {
    productLinks: ['.card-figure a', '.productGrid a[href*="/"]', '.product-item a'],
    nextPage: ['.pagination-item--next a', 'a[rel="next"]'],
  },
  woocommerce: {
    productLinks: ['.woocommerce-LoopProduct-link', 'a.wc-block-grid__product', '.product a[href*="/product/"]'],
    nextPage: ['a.next.page-numbers', 'a[rel="next"]'],
  },
  generic: {
    productLinks: [
      'a[href*="/product"]', 'a[href*="/products/"]', 'a[href*="/shop/"]',
      'a[href*="/p/"]', '.product a', '.product-card a',
    ],
    nextPage: ['a[rel="next"]', '.next a', 'a.next', '.pagination .next a'],
  },
};

/**
 * Find the first matching element on the page from a list of selectors.
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @returns {Promise<import('playwright').ElementHandle|null>}
 */
async function findFirst(page, selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

/**
 * Extract product links from a page using platform-appropriate selectors.
 * @param {import('playwright').Page} page
 * @param {string} platform
 * @returns {Promise<string[]>}
 */
async function extractProductLinks(page, platform) {
  const selectors = PLATFORM_SELECTORS[platform] || PLATFORM_SELECTORS.generic;
  const links = new Set();

  for (const selector of selectors.productLinks) {
    const elements = await page.$$(selector);
    for (const el of elements) {
      const href = await el.getAttribute('href');
      if (href) {
        try {
          const fullUrl = new URL(href, page.url()).href;
          // Filter out anchors, javascript, mailto
          if (fullUrl.startsWith('http')) {
            links.add(fullUrl.split('?')[0].split('#')[0]);
          }
        } catch { /* ignore invalid URLs */ }
      }
    }
  }

  return [...links];
}

/**
 * Find and click the "next page" link, returning the new URL or null.
 * @param {import('playwright').Page} page
 * @param {string} platform
 * @returns {Promise<string|null>}
 */
async function findNextPage(page, platform) {
  const selectors = PLATFORM_SELECTORS[platform] || PLATFORM_SELECTORS.generic;
  const el = await findFirst(page, selectors.nextPage);
  if (!el) return null;

  const href = await el.getAttribute('href');
  if (!href) return null;

  try {
    return new URL(href, page.url()).href;
  } catch {
    return null;
  }
}

/**
 * Discover product URLs by crawling category/collection pages with pagination.
 *
 * @param {import('playwright').Page} page
 * @param {string} startUrl
 * @param {{ platform?: string, maxPages?: number, logger?: object }} [options]
 * @returns {Promise<string[]>}
 */
export async function discoverFromCategory(page, startUrl, options = {}) {
  const { platform = 'generic', maxPages = 100, logger } = options;
  const allLinks = new Set();
  let currentUrl = startUrl;
  let pageCount = 0;

  while (currentUrl && pageCount < maxPages) {
    pageCount += 1;
    if (logger) logger.debug(`Category page ${pageCount}: ${currentUrl}`);

    try {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Wait a moment for dynamic content
      await page.waitForTimeout(1000);
    } catch (err) {
      if (logger) logger.warn(`Failed to load category page: ${currentUrl} — ${err.message}`);
      break;
    }

    const links = await extractProductLinks(page, platform);
    for (const link of links) allLinks.add(link);

    if (logger) logger.debug(`Found ${links.length} products on page ${pageCount} (${allLinks.size} total)`);

    const nextUrl = await findNextPage(page, platform);
    // Avoid infinite loops
    if (nextUrl === currentUrl) break;
    currentUrl = nextUrl;
  }

  return [...allLinks];
}
