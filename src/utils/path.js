/**
 * Product Bus path pattern from Commerce API validation.js
 * - Directory segments allow underscores (e.g., en_us)
 * - Filename (last segment) only allows hyphens, no underscores
 */
export const PATH_PATTERN = /^\/([a-z0-9_]+([-_][a-z0-9_]+)*\/)*[a-z0-9]+(-[a-z0-9]+)*$/;

const MAX_PATH_LENGTH = 900;

const STRIP_EXTENSIONS = ['.html', '.htm', '.php', '.aspx', '.jsp', '.shtml'];

/**
 * Convert a source URL into a valid Product Bus path.
 *
 * @param {string} url - The source URL (e.g., https://store.com/products/Cool-Widget.html)
 * @param {{ prefix?: string }} [options]
 * @returns {string|null} - Valid path or null if conversion fails
 */
export function urlToProductBusPath(url, options = {}) {
  const { prefix } = options;

  let pathname;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
  } catch {
    // If not a valid URL, treat it as a pathname
    pathname = url.split('?')[0].split('#')[0];
  }

  // Strip file extensions
  for (const ext of STRIP_EXTENSIONS) {
    if (pathname.toLowerCase().endsWith(ext)) {
      pathname = pathname.slice(0, -ext.length);
      break;
    }
  }

  // Strip trailing slash
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Lowercase
  pathname = pathname.toLowerCase();

  // Replace characters not in [a-z0-9/-] with hyphens
  pathname = pathname.replace(/[^a-z0-9/\-]/g, '-');

  // Collapse consecutive hyphens
  pathname = pathname.replace(/-{2,}/g, '-');

  // Clean each segment: remove leading/trailing hyphens
  const segments = pathname.split('/').filter(Boolean).map((seg) => {
    let s = seg;
    while (s.startsWith('-')) s = s.slice(1);
    while (s.endsWith('-')) s = s.slice(0, -1);
    return s;
  }).filter(Boolean);

  // Rebuild path
  let path = `/${segments.join('/')}`;

  // Apply prefix
  if (prefix) {
    const cleanPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
    path = `${cleanPrefix}${path}`;
  }

  // Collapse any double slashes
  path = path.replace(/\/{2,}/g, '/');

  // Enforce max length
  if (path.length > MAX_PATH_LENGTH) {
    return null;
  }

  // Validate against pattern
  if (!PATH_PATTERN.test(path)) {
    return null;
  }

  return path;
}

/**
 * Sanitize a SKU string.
 * @param {string} sku
 * @returns {string}
 */
export function sanitizeSku(sku) {
  if (!sku) return '';
  return String(sku).trim();
}

/**
 * Derive a fallback SKU from a URL when no SKU is found on the page.
 * @param {string} url
 * @returns {string}
 */
export function skuFromUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  // Take the last segment, uppercase, replace non-alphanumeric with hyphens
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || 'unknown';
  return last
    .replace(/\.[^.]+$/, '') // strip extension
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
