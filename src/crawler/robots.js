/**
 * Fetch and parse robots.txt for a given base URL.
 * @param {string} baseUrl
 * @returns {Promise<{ sitemaps: string[], crawlDelay: number, disallowed: string[], allowed: string[] }>}
 */
export async function fetchRobotsTxt(baseUrl) {
  const url = new URL('/robots.txt', baseUrl).href;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CatalogIngestion/1.0)' },
    });
    if (!res.ok) {
      return { sitemaps: [], crawlDelay: 0, disallowed: [], allowed: [] };
    }
    const text = await res.text();
    return parseRobotsTxt(text);
  } catch {
    return { sitemaps: [], crawlDelay: 0, disallowed: [], allowed: [] };
  }
}

/**
 * Parse robots.txt content.
 * @param {string} content
 * @returns {{ sitemaps: string[], crawlDelay: number, disallowed: string[], allowed: string[] }}
 */
export function parseRobotsTxt(content) {
  const sitemaps = [];
  const disallowed = [];
  const allowed = [];
  let crawlDelay = 0;
  let inWildcardBlock = false;

  const lines = content.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const lower = line.toLowerCase();

    // Sitemap directives are global (not user-agent specific)
    if (lower.startsWith('sitemap:')) {
      sitemaps.push(line.slice('sitemap:'.length).trim());
      continue;
    }

    if (lower.startsWith('user-agent:')) {
      const agent = line.slice('user-agent:'.length).trim();
      inWildcardBlock = agent === '*';
      continue;
    }

    // Only parse rules from the wildcard block
    if (!inWildcardBlock) continue;

    if (lower.startsWith('disallow:')) {
      const path = line.slice('disallow:'.length).trim();
      if (path) disallowed.push(path);
    } else if (lower.startsWith('allow:')) {
      const path = line.slice('allow:'.length).trim();
      if (path) allowed.push(path);
    } else if (lower.startsWith('crawl-delay:')) {
      const val = parseFloat(line.slice('crawl-delay:'.length).trim());
      if (!Number.isNaN(val)) crawlDelay = val;
    }
  }

  return { sitemaps, crawlDelay, disallowed, allowed };
}

/**
 * Check if a URL path is allowed by robots.txt rules.
 * @param {string} url
 * @param {{ disallowed: string[], allowed: string[] }} rules
 * @returns {boolean}
 */
export function isAllowed(url, rules) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  // Check allowed first (more specific wins)
  for (const pattern of rules.allowed) {
    if (pathname.startsWith(pattern)) return true;
  }
  for (const pattern of rules.disallowed) {
    if (pathname.startsWith(pattern)) return false;
  }
  return true;
}
