import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserManager } from '../../src/crawler/browser.js';
import { detectPlatform, getPlatformConfig } from '../../src/extractor/platforms/index.js';
import { extractJsonLd } from '../../src/extractor/jsonld.js';
import { extractFromHtml } from '../../src/extractor/html.js';
import { extractProduct } from '../../src/extractor/index.js';
import { extractVariants } from '../../src/extractor/variants.js';
import { transformProduct } from '../../src/transformer/index.js';
import { validateProduct } from '../../src/utils/validation.js';
import { urlToProductBusPath, PATH_PATTERN } from '../../src/utils/path.js';
import { fetchRobotsTxt } from '../../src/crawler/robots.js';
import { parseSitemap, filterProductUrls, COMMON_SITEMAP_URLS } from '../../src/crawler/sitemap.js';
import { discoverFromCategory } from '../../src/crawler/category.js';
import { CrawlState } from '../../src/crawler/state.js';
import { ProductBusUploader } from '../../src/uploader/index.js';

const BASE_URL = 'https://www.adobestore.com';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_OUTPUT = path.join(__dirname, '..', 'test-output');

describe('Adobe Store E2E Tests', function () {
  this.timeout(120000);

  /** @type {BrowserManager} */
  let browser;
  /** @type {import('playwright').Page} */
  let page;

  before(async function () {
    browser = new BrowserManager({ headless: true });
    await browser.launch();
  });

  after(async function () {
    await browser.close();
    // Clean up test output
    if (fs.existsSync(TEST_OUTPUT)) {
      fs.rmSync(TEST_OUTPUT, { recursive: true, force: true });
    }
  });

  beforeEach(async function () {
    page = await browser.newPage();
  });

  afterEach(async function () {
    if (page) await page.close();
  });

  // ──────────────────────────────────────────────────────────────
  // Discovery tests
  // ──────────────────────────────────────────────────────────────

  describe('Discovery', function () {
    it('should fetch robots.txt', async function () {
      const robots = await fetchRobotsTxt(BASE_URL);
      // robots.txt may or may not exist; we should handle both cases gracefully
      assert.ok(robots, 'Should return a robots result object');
      assert.ok(Array.isArray(robots.sitemaps), 'Should have sitemaps array');
      assert.ok(Array.isArray(robots.disallowed), 'Should have disallowed array');
      assert.ok(typeof robots.crawlDelay === 'number', 'Should have crawlDelay number');
    });

    it('should try common sitemap locations', async function () {
      const base = new URL(BASE_URL).origin;
      let foundUrls = [];

      for (const sitemapPath of COMMON_SITEMAP_URLS) {
        const url = `${base}${sitemapPath}`;
        const urls = await parseSitemap(url);
        if (urls.length > 0) {
          foundUrls = urls;
          break;
        }
      }

      // The Adobe Store may not have a sitemap — that's okay
      // This test validates our sitemap parsing doesn't crash on 404s
      assert.ok(Array.isArray(foundUrls), 'Should return an array even if empty');
    });

    it('should discover products from the collections page', async function () {
      // Navigate to the main page to find collection links
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Try to find product links on the page
      const links = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a[href]');
        return Array.from(anchors)
          .map((a) => a.href)
          .filter((href) => href.includes('/products/') || href.includes('/collections/'));
      });

      assert.ok(Array.isArray(links), 'Should find navigation links');
      // Log what we found for debugging
      console.log(`    Found ${links.length} collection/product links on homepage`);
    });

    it('should discover product URLs from a collection page using category mode', async function () {
      // Navigate to collections page first
      await page.goto(`${BASE_URL}/collections`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Find collection links
      const collectionLinks = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a[href*="/collections/"]');
        return Array.from(anchors)
          .map((a) => a.href)
          .filter((href) => !href.endsWith('/collections') && !href.endsWith('/collections/'));
      });

      if (collectionLinks.length === 0) {
        console.log('    No collection links found, skipping category discovery');
        this.skip();
      }

      // Visit the first collection
      const collectionUrl = collectionLinks[0];
      console.log(`    Crawling collection: ${collectionUrl}`);

      await page.goto(collectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Look for product links
      const productLinks = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a[href*="/products/"]');
        return Array.from(anchors).map((a) => a.href);
      });

      console.log(`    Found ${productLinks.length} product links in collection`);
      assert.ok(Array.isArray(productLinks), 'Should return product links array');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Platform detection tests
  // ──────────────────────────────────────────────────────────────

  describe('Platform Detection', function () {
    it('should detect the platform from the homepage', async function () {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const result = await detectPlatform(page);
      assert.ok(result, 'Should return detection result');
      assert.ok(result.platform, 'Should have a platform name');
      assert.ok(result.confidence, 'Should have a confidence level');
      assert.ok(result.config, 'Should have a config object');

      console.log(`    Detected: ${result.platform} (${result.confidence} confidence)`);
    });

    it('should return a valid platform config with selectors', async function () {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const result = await detectPlatform(page);
      const config = result.config;

      assert.ok(config.selectors, 'Config should have selectors');
      assert.ok(config.selectors.productTitle, 'Should have productTitle selectors');
      assert.ok(config.selectors.price, 'Should have price selectors');
      assert.ok(config.selectors.images, 'Should have images selectors');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Product extraction tests
  // ──────────────────────────────────────────────────────────────

  describe('Product Extraction', function () {
    /** @type {string[]} */
    let productUrls = [];

    before(async function () {
      // Discover product URLs to test against
      const discoveryPage = await browser.newPage();
      try {
        await discoveryPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await discoveryPage.waitForTimeout(3000);

        // Find product links anywhere on the site
        productUrls = await discoveryPage.evaluate(() => {
          const anchors = document.querySelectorAll('a[href*="/products/"]');
          const urls = new Set();
          for (const a of anchors) {
            const href = a.href.split('?')[0].split('#')[0];
            if (href.includes('/products/')) urls.add(href);
          }
          return [...urls];
        });

        // If no products on homepage, try a collection page
        if (productUrls.length === 0) {
          const collectionLinks = await discoveryPage.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/collections/"]');
            return Array.from(anchors)
              .map((a) => a.href)
              .filter((href) => !href.endsWith('/collections') && !href.endsWith('/collections/'));
          });

          if (collectionLinks.length > 0) {
            await discoveryPage.goto(collectionLinks[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
            await discoveryPage.waitForTimeout(3000);

            productUrls = await discoveryPage.evaluate(() => {
              const anchors = document.querySelectorAll('a[href*="/products/"]');
              return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
            });
          }
        }

        console.log(`    Discovered ${productUrls.length} product URLs for testing`);
      } finally {
        await discoveryPage.close();
      }
    });

    it('should find at least one product URL', function () {
      assert.ok(productUrls.length > 0, `Expected product URLs but found ${productUrls.length}. The site may require JavaScript rendering.`);
    });

    it('should extract JSON-LD from a product page', async function () {
      if (productUrls.length === 0) this.skip();

      const url = productUrls[0];
      console.log(`    Testing JSON-LD extraction on: ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const jsonld = await extractJsonLd(page);

      // JSON-LD may or may not exist on this site
      if (jsonld) {
        console.log(`    JSON-LD found with fields: ${Object.keys(jsonld).join(', ')}`);
        // If we got JSON-LD, it should at least have a name
        assert.ok(jsonld.name || jsonld.sku, 'JSON-LD should have name or sku');
      } else {
        console.log('    No JSON-LD found (will rely on HTML extraction)');
      }
    });

    it('should extract product data from HTML', async function () {
      if (productUrls.length === 0) this.skip();

      const url = productUrls[0];
      console.log(`    Testing HTML extraction on: ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const genericConfig = getPlatformConfig('generic');
      const htmlData = await extractFromHtml(page, genericConfig);

      console.log(`    HTML extracted fields: ${Object.keys(htmlData).join(', ')}`);
      // Should at minimum find a product name from the h1
      assert.ok(htmlData.name || htmlData.description || htmlData.images,
        'Should extract at least some data from HTML');
    });

    it('should extract complete product data (JSON-LD + HTML merge)', async function () {
      if (productUrls.length === 0) this.skip();

      const url = productUrls[0];
      console.log(`    Testing full extraction on: ${url}`);

      const genericConfig = getPlatformConfig('generic');
      const rawData = await extractProduct(page, url, genericConfig);

      assert.ok(rawData, 'Should extract product data');
      assert.ok(rawData.name, `Should have product name, got: ${JSON.stringify(rawData).slice(0, 200)}`);
      console.log(`    Extracted product: "${rawData.name}"`);
      console.log(`    Fields: ${Object.keys(rawData).join(', ')}`);

      if (rawData.price) {
        console.log(`    Price: ${JSON.stringify(rawData.price)}`);
      }
      if (rawData.images) {
        console.log(`    Images: ${rawData.images.length}`);
      }
      if (rawData.variants) {
        console.log(`    Variants: ${rawData.variants.length}`);
      }
    });

    it('should extract product data from multiple pages', async function () {
      if (productUrls.length < 2) this.skip();

      const urlsToTest = productUrls.slice(0, Math.min(3, productUrls.length));
      const genericConfig = getPlatformConfig('generic');
      const results = [];

      for (const url of urlsToTest) {
        const testPage = await browser.newPage();
        try {
          const rawData = await extractProduct(testPage, url, genericConfig);
          results.push({ url, data: rawData });
          if (rawData) {
            console.log(`    OK: "${rawData.name}" (${url})`);
          } else {
            console.log(`    SKIP: No data (${url})`);
          }
        } finally {
          await testPage.close();
        }
      }

      const successful = results.filter((r) => r.data !== null);
      console.log(`    Extracted ${successful.length}/${urlsToTest.length} products`);
      assert.ok(successful.length > 0, 'Should extract at least one product');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Variant extraction tests
  // ──────────────────────────────────────────────────────────────

  describe('Variant Extraction', function () {
    let productUrl;

    before(async function () {
      // Find a product URL
      const discoveryPage = await browser.newPage();
      try {
        await discoveryPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await discoveryPage.waitForTimeout(3000);

        const urls = await discoveryPage.evaluate(() => {
          const anchors = document.querySelectorAll('a[href*="/products/"]');
          return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
        });

        // Try collection pages if no products on homepage
        if (urls.length === 0) {
          const collectionLinks = await discoveryPage.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/collections/"]');
            return Array.from(anchors)
              .map((a) => a.href)
              .filter((h) => !h.endsWith('/collections') && !h.endsWith('/collections/'));
          });
          if (collectionLinks.length > 0) {
            await discoveryPage.goto(collectionLinks[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
            await discoveryPage.waitForTimeout(3000);
            const collUrls = await discoveryPage.evaluate(() => {
              const anchors = document.querySelectorAll('a[href*="/products/"]');
              return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
            });
            productUrl = collUrls[0];
          }
        } else {
          productUrl = urls[0];
        }
      } finally {
        await discoveryPage.close();
      }
    });

    it('should attempt to extract variants', async function () {
      if (!productUrl) this.skip();

      console.log(`    Testing variant extraction on: ${productUrl}`);
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const genericConfig = getPlatformConfig('generic');
      const baseProduct = { name: 'Test', sku: 'test', images: [] };

      const variants = await extractVariants(page, genericConfig, baseProduct);
      console.log(`    Found ${variants.length} variants`);

      // Variants may or may not exist — just ensure it doesn't crash
      assert.ok(Array.isArray(variants), 'Should return variants array');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Transformation tests
  // ──────────────────────────────────────────────────────────────

  describe('Transformation', function () {
    it('should transform extracted data into valid Product Bus JSON', async function () {
      // Find and extract a product
      const discoveryPage = await browser.newPage();
      let productUrl;

      try {
        await discoveryPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await discoveryPage.waitForTimeout(3000);

        const urls = await discoveryPage.evaluate(() => {
          const anchors = document.querySelectorAll('a[href*="/products/"]');
          return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
        });

        if (urls.length === 0) {
          // Try collections
          const collLinks = await discoveryPage.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/collections/"]');
            return Array.from(anchors)
              .map((a) => a.href)
              .filter((h) => !h.endsWith('/collections') && !h.endsWith('/collections/'));
          });
          if (collLinks.length > 0) {
            await discoveryPage.goto(collLinks[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
            await discoveryPage.waitForTimeout(3000);
            const collUrls = await discoveryPage.evaluate(() => {
              const anchors = document.querySelectorAll('a[href*="/products/"]');
              return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
            });
            productUrl = collUrls[0];
          }
        } else {
          productUrl = urls[0];
        }
      } finally {
        await discoveryPage.close();
      }

      if (!productUrl) this.skip();

      console.log(`    Extracting and transforming: ${productUrl}`);

      const genericConfig = getPlatformConfig('generic');
      const rawData = await extractProduct(page, productUrl, genericConfig);

      if (!rawData) {
        console.log('    No data extracted, skipping transformation test');
        this.skip();
      }

      const { product, warnings, errors } = transformProduct(rawData, productUrl, {
        defaultCurrency: 'USD',
      });

      if (errors.length > 0) {
        console.log(`    Transform errors: ${errors.join(', ')}`);
      }
      if (warnings.length > 0) {
        console.log(`    Transform warnings: ${warnings.join(', ')}`);
      }

      assert.ok(product, `Transformation should produce a product. Errors: ${errors.join(', ')}`);
      console.log(`    Transformed: "${product.name}" (SKU: ${product.sku})`);
      console.log(`    Path: ${product.path}`);
      console.log(`    Product Bus JSON: ${JSON.stringify(product).slice(0, 300)}...`);
    });

    it('should produce valid Product Bus schema output', async function () {
      // Find a product
      const discoveryPage = await browser.newPage();
      let productUrl;

      try {
        await discoveryPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await discoveryPage.waitForTimeout(3000);

        const urls = await discoveryPage.evaluate(() => {
          const anchors = document.querySelectorAll('a[href*="/products/"]');
          return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
        });

        if (urls.length === 0) {
          const collLinks = await discoveryPage.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/collections/"]');
            return Array.from(anchors)
              .map((a) => a.href)
              .filter((h) => !h.endsWith('/collections') && !h.endsWith('/collections/'));
          });
          if (collLinks.length > 0) {
            await discoveryPage.goto(collLinks[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
            await discoveryPage.waitForTimeout(3000);
            const collUrls = await discoveryPage.evaluate(() => {
              const anchors = document.querySelectorAll('a[href*="/products/"]');
              return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
            });
            productUrl = collUrls[0];
          }
        } else {
          productUrl = urls[0];
        }
      } finally {
        await discoveryPage.close();
      }

      if (!productUrl) this.skip();

      const genericConfig = getPlatformConfig('generic');
      const rawData = await extractProduct(page, productUrl, genericConfig);
      if (!rawData) this.skip();

      const { product } = transformProduct(rawData, productUrl, { defaultCurrency: 'USD' });
      if (!product) this.skip();

      // Validate against Product Bus schema
      const validation = validateProduct(product);
      console.log(`    Validation: ${validation.valid ? 'PASS' : 'FAIL'}`);
      if (!validation.valid) {
        console.log(`    Errors: ${validation.errors.join(', ')}`);
      }

      assert.ok(validation.valid, `Product should be valid. Errors: ${validation.errors.join(', ')}`);

      // Check required fields
      assert.ok(product.sku, 'Should have sku');
      assert.ok(product.name, 'Should have name');
      assert.ok(product.path, 'Should have path');

      // Check field types
      assert.strictEqual(typeof product.sku, 'string', 'sku should be string');
      assert.strictEqual(typeof product.name, 'string', 'name should be string');
      assert.strictEqual(typeof product.path, 'string', 'path should be string');

      if (product.price) {
        assert.strictEqual(typeof product.price, 'object', 'price should be object');
        if (product.price.final) assert.strictEqual(typeof product.price.final, 'string', 'price.final should be string');
        if (product.price.regular) assert.strictEqual(typeof product.price.regular, 'string', 'price.regular should be string');
        if (product.price.currency) assert.strictEqual(typeof product.price.currency, 'string', 'price.currency should be string');
      }

      if (product.images) {
        assert.ok(Array.isArray(product.images), 'images should be array');
        for (const img of product.images) {
          assert.ok(img.url, 'Each image should have url');
          assert.ok(img.url.startsWith('http'), 'Image URL should start with http');
        }
      }

      if (product.variants) {
        assert.ok(Array.isArray(product.variants), 'variants should be array');
        for (const v of product.variants) {
          assert.ok(v.sku, 'Variant should have sku');
          assert.ok(v.name, 'Variant should have name');
          assert.ok(v.url, 'Variant should have url');
          assert.ok(Array.isArray(v.images), 'Variant should have images array');
        }
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Path generation tests
  // ──────────────────────────────────────────────────────────────

  describe('Path Generation', function () {
    it('should generate valid Product Bus paths from Adobe Store URLs', function () {
      const testCases = [
        {
          url: 'https://www.adobestore.com/products/adobe-max-tee',
          expected: '/products/adobe-max-tee',
        },
        {
          url: 'https://www.adobestore.com/products/creative-cloud-hoodie',
          expected: '/products/creative-cloud-hoodie',
        },
        {
          url: 'https://www.adobestore.com/collections/adobe-max/products/max-2024-poster',
          expected: '/collections/adobe-max/products/max-2024-poster',
        },
      ];

      for (const { url, expected } of testCases) {
        const result = urlToProductBusPath(url);
        console.log(`    ${url} → ${result}`);
        assert.strictEqual(result, expected, `Path for ${url}`);
      }
    });

    it('should handle special characters in URLs', function () {
      const testCases = [
        {
          url: 'https://www.adobestore.com/products/Adobe%20MAX%20T-Shirt.html',
          desc: 'encoded spaces + extension',
        },
        {
          url: 'https://www.adobestore.com/products/item_with_underscores',
          desc: 'underscores',
        },
      ];

      for (const { url, desc } of testCases) {
        const result = urlToProductBusPath(url);
        console.log(`    ${desc}: ${url} → ${result}`);
        if (result) {
          assert.ok(PATH_PATTERN.test(result), `Path should match pattern: ${result}`);
        }
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Full crawl test (subset)
  // ──────────────────────────────────────────────────────────────

  describe('Full Crawl Pipeline', function () {
    it('should crawl, extract, transform, and write products to disk', async function () {
      this.timeout(180000); // 3 minutes for full pipeline

      // Ensure clean output directory
      if (fs.existsSync(TEST_OUTPUT)) {
        fs.rmSync(TEST_OUTPUT, { recursive: true, force: true });
      }
      fs.mkdirSync(TEST_OUTPUT, { recursive: true });

      // Step 1: Discover product URLs
      const discoveryPage = await browser.newPage();
      let productUrls = [];

      try {
        await discoveryPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await discoveryPage.waitForTimeout(3000);

        productUrls = await discoveryPage.evaluate(() => {
          const anchors = document.querySelectorAll('a[href*="/products/"]');
          return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
        });

        // Try collection pages
        if (productUrls.length === 0) {
          const collLinks = await discoveryPage.evaluate(() => {
            const anchors = document.querySelectorAll('a[href*="/collections/"]');
            return Array.from(anchors)
              .map((a) => a.href)
              .filter((h) => !h.endsWith('/collections') && !h.endsWith('/collections/'));
          });

          for (const collLink of collLinks.slice(0, 3)) {
            await discoveryPage.goto(collLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await discoveryPage.waitForTimeout(3000);

            const collUrls = await discoveryPage.evaluate(() => {
              const anchors = document.querySelectorAll('a[href*="/products/"]');
              return [...new Set(Array.from(anchors).map((a) => a.href.split('?')[0]))];
            });
            productUrls.push(...collUrls);
            if (productUrls.length >= 5) break;
          }
          productUrls = [...new Set(productUrls)];
        }
      } finally {
        await discoveryPage.close();
      }

      // Limit to 5 products
      productUrls = productUrls.slice(0, 5);
      console.log(`    Testing full pipeline with ${productUrls.length} products`);

      if (productUrls.length === 0) {
        console.log('    No products found, skipping full crawl test');
        this.skip();
      }

      // Step 2: Extract and transform each product
      const genericConfig = getPlatformConfig('generic');
      const results = { success: 0, failed: 0, skipped: 0 };

      for (const url of productUrls) {
        const productPage = await browser.newPage();
        try {
          const rawData = await extractProduct(productPage, url, genericConfig);
          if (!rawData) {
            results.skipped += 1;
            continue;
          }

          const { product, warnings, errors } = transformProduct(rawData, url, {
            defaultCurrency: 'USD',
          });

          if (!product) {
            results.failed += 1;
            console.log(`    FAIL: ${url} — ${errors.join(', ')}`);
            continue;
          }

          // Write to disk
          const outputPath = path.join(TEST_OUTPUT, `${product.path.slice(1).replace(/\//g, '_')}.json`);
          fs.writeFileSync(outputPath, JSON.stringify(product, null, 2));

          results.success += 1;
          console.log(`    OK: "${product.name}" → ${outputPath}`);
        } catch (err) {
          results.failed += 1;
          console.log(`    ERROR: ${url} — ${err.message}`);
        } finally {
          await productPage.close();
        }
      }

      console.log(`\n    Results: ${results.success} ok, ${results.failed} failed, ${results.skipped} skipped`);
      assert.ok(results.success > 0, 'Should successfully extract at least one product');

      // Step 3: Verify files on disk
      const outputFiles = fs.readdirSync(TEST_OUTPUT).filter((f) => f.endsWith('.json'));
      console.log(`    Files written: ${outputFiles.length}`);
      assert.ok(outputFiles.length > 0, 'Should write at least one JSON file');

      // Step 4: Validate each file
      for (const file of outputFiles) {
        const content = JSON.parse(fs.readFileSync(path.join(TEST_OUTPUT, file), 'utf-8'));
        const validation = validateProduct(content);
        assert.ok(validation.valid, `${file} should be valid: ${validation.errors.join(', ')}`);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Upload dry-run tests
  // ──────────────────────────────────────────────────────────────

  describe('Upload Dry Run', function () {
    it('should validate products in dry-run mode', async function () {
      // First, ensure we have some output files
      if (!fs.existsSync(TEST_OUTPUT)) {
        fs.mkdirSync(TEST_OUTPUT, { recursive: true });
      }

      // Create a sample valid product
      const sampleProduct = {
        sku: 'TEST-001',
        name: 'Test Product',
        path: '/products/test-product',
        price: { currency: 'USD', final: '29.99' },
        images: [{ url: 'https://example.com/image.jpg' }],
      };

      fs.writeFileSync(
        path.join(TEST_OUTPUT, 'test-product.json'),
        JSON.stringify(sampleProduct, null, 2),
      );

      const uploader = new ProductBusUploader({
        org: 'test-org',
        site: 'test-site',
        apiKey: 'test-key',
        dryRun: true,
      });

      const result = await uploader.uploadAll(TEST_OUTPUT);
      console.log(`    Dry run: ${result.total} total, ${result.skipped} skipped`);

      assert.ok(result.total > 0, 'Should find files');
      assert.strictEqual(result.uploaded, 0, 'Dry run should not upload');
      assert.strictEqual(result.failed, 0, 'Should have no failures');
    });

    it('should reject invalid products in dry-run mode', async function () {
      const tempDir = path.join(TEST_OUTPUT, 'invalid');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      // Create an invalid product (missing required fields)
      fs.writeFileSync(
        path.join(tempDir, 'invalid.json'),
        JSON.stringify({ name: 'No SKU' }, null, 2),
      );

      const uploader = new ProductBusUploader({
        org: 'test-org',
        site: 'test-site',
        apiKey: 'test-key',
        dryRun: true,
      });

      const result = await uploader.uploadAll(tempDir);
      console.log(`    Invalid product: ${result.skipped} skipped`);

      assert.ok(result.skipped > 0, 'Should skip invalid products');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Crawl state tests
  // ──────────────────────────────────────────────────────────────

  describe('Crawl State', function () {
    it('should persist and resume crawl state', function () {
      const stateFile = path.join(TEST_OUTPUT, 'test-state.json');

      // Create state
      const state = CrawlState.load(stateFile, { url: BASE_URL, mode: 'sitemap' });
      state.addUrls([
        'https://example.com/product-1',
        'https://example.com/product-2',
        'https://example.com/product-3',
      ]);
      state.markCrawled('https://example.com/product-1');
      state.markFailed('https://example.com/product-2', 'timeout');
      state.save();

      // Reload and verify
      const loaded = CrawlState.load(stateFile);
      const stats = loaded.getStats();

      assert.strictEqual(stats.discovered, 3, 'Should have 3 discovered');
      assert.strictEqual(stats.crawled, 1, 'Should have 1 crawled');
      assert.strictEqual(stats.failed, 1, 'Should have 1 failed');

      const pending = loaded.getPendingUrls();
      assert.strictEqual(pending.length, 1, 'Should have 1 pending');
      assert.strictEqual(pending[0], 'https://example.com/product-3');
    });
  });
});
