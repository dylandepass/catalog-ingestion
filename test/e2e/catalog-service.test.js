import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogServiceClient } from '../../src/catalog-service/client.js';
import { normalizeProduct } from '../../src/catalog-service/normalizer.js';
import { transformProduct } from '../../src/transformer/index.js';
import { validateProduct } from '../../src/utils/validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_OUTPUT = path.join(__dirname, '..', 'test-cs-output');

const CS_ENDPOINT = 'https://edge-graph.adobe.io/api/b8226c70-6dad-4c85-a17b-9b0a3fc3abe2/graphql';
const CS_ENVIRONMENT_ID = 'VyumfC53bDYkVB6b8MXsJh';
const CS_CUSTOMER_GROUP = 'b6589fc6ab0dc82cf12099d1c2d40ab994e8410c';
const BASE_URL = 'https://www.adobestore.com';

describe('Catalog Service E2E Tests', function () {
  this.timeout(120000);

  /** @type {CatalogServiceClient} */
  let client;

  before(function () {
    client = new CatalogServiceClient({
      endpoint: CS_ENDPOINT,
      environmentId: CS_ENVIRONMENT_ID,
      storeCode: 'main_website_store',
      storeViewCode: 'default',
      websiteCode: 'base',
      customerGroup: CS_CUSTOMER_GROUP,
      apiKey: 'not_used',
    });
  });

  after(function () {
    if (fs.existsSync(TEST_OUTPUT)) {
      fs.rmSync(TEST_OUTPUT, { recursive: true, force: true });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Product discovery
  // ──────────────────────────────────────────────────────────────

  describe('Product Discovery', function () {
    it('should list products from the catalog', async function () {
      const products = await client.listAllProducts({ maxProducts: 5 });

      assert.ok(products.length > 0, 'Should find products');
      assert.ok(products.length <= 5, 'Should respect maxProducts limit');
      console.log(`    Found ${products.length} products`);

      for (const p of products) {
        assert.ok(p.sku, 'Product should have SKU');
        assert.ok(p.name, 'Product should have name');
        assert.ok(p.__typename, 'Product should have __typename');
        console.log(`    ${p.sku}: ${p.name} (${p.__typename})`);
      }
    });

    it('should paginate through all products', async function () {
      this.timeout(60000);

      const pages = [];
      const products = await client.listAllProducts({
        onPage: (page, total) => pages.push({ page, total }),
      });

      assert.ok(products.length > 50, `Should find more than 50 products (found ${products.length})`);
      assert.ok(pages.length > 1, `Should paginate across multiple pages (got ${pages.length})`);
      console.log(`    Total: ${products.length} products across ${pages.length} pages`);

      // All products should have unique SKUs
      const skus = new Set(products.map((p) => p.sku));
      assert.strictEqual(skus.size, products.length, 'All SKUs should be unique');
    });

    it('should include both simple and complex products', async function () {
      const products = await client.listAllProducts();

      const simple = products.filter((p) => p.__typename === 'SimpleProductView');
      const complex = products.filter((p) => p.__typename === 'ComplexProductView');

      console.log(`    Simple: ${simple.length}, Complex: ${complex.length}`);
      assert.ok(simple.length > 0, 'Should have simple products');
      assert.ok(complex.length > 0, 'Should have complex products');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Product details
  // ──────────────────────────────────────────────────────────────

  describe('Product Details', function () {
    /** @type {object[]} */
    let productList;

    before(async function () {
      productList = await client.listAllProducts({ maxProducts: 10 });
    });

    it('should fetch full product details in batch', async function () {
      const skus = productList.map((p) => p.sku);
      const details = await client.fetchProducts(skus);

      assert.strictEqual(details.length, skus.length, 'Should return details for all SKUs');
      console.log(`    Fetched details for ${details.length} products`);

      for (const product of details) {
        assert.ok(product.sku, 'Should have SKU');
        assert.ok(product.name, 'Should have name');
        assert.ok(product.__typename, 'Should have __typename');
        assert.ok(typeof product.inStock === 'boolean', 'Should have inStock boolean');
      }
    });

    it('should return images for products', async function () {
      const skus = productList.map((p) => p.sku);
      const details = await client.fetchProducts(skus);

      const withImages = details.filter((p) => p.images?.length > 0);
      console.log(`    ${withImages.length}/${details.length} products have images`);
      assert.ok(withImages.length > 0, 'At least some products should have images');

      for (const product of withImages) {
        for (const img of product.images) {
          assert.ok(img.url, 'Image should have URL');
          assert.ok(img.url.startsWith('http'), `Image URL should be absolute: ${img.url}`);
        }
      }
    });

    it('should return price data for simple products', async function () {
      const skus = productList
        .filter((p) => p.__typename === 'SimpleProductView')
        .map((p) => p.sku);

      if (skus.length === 0) this.skip();

      const details = await client.fetchProducts(skus);
      const simple = details.filter((p) => p.__typename === 'SimpleProductView');

      for (const product of simple) {
        assert.ok(product.price, `${product.sku} should have price`);
        assert.ok(product.price.final?.amount?.value != null, `${product.sku} should have final price value`);
        assert.ok(product.price.final?.amount?.currency, `${product.sku} should have currency`);
        console.log(`    ${product.sku}: $${product.price.final.amount.value} ${product.price.final.amount.currency}`);
      }
    });

    it('should return options and priceRange for complex products', async function () {
      const skus = productList
        .filter((p) => p.__typename === 'ComplexProductView')
        .map((p) => p.sku);

      if (skus.length === 0) this.skip();

      const details = await client.fetchProducts(skus);
      const complex = details.filter((p) => p.__typename === 'ComplexProductView');

      for (const product of complex) {
        assert.ok(product.priceRange, `${product.sku} should have priceRange`);
        assert.ok(product.priceRange.minimum?.final, `${product.sku} should have minimum final price`);
        assert.ok(product.options?.length > 0, `${product.sku} should have options`);

        console.log(`    ${product.sku}: ${product.options.length} options`);
        for (const opt of product.options) {
          assert.ok(opt.id, 'Option should have id');
          assert.ok(opt.title, 'Option should have title');
          assert.ok(opt.values?.length > 0, `Option "${opt.title}" should have values`);

          for (const val of opt.values) {
            assert.ok(val.id, `Option value "${val.title}" should have id (UID)`);
            assert.ok(val.title, 'Option value should have title');
          }

          console.log(`      ${opt.title}: ${opt.values.map((v) => v.title).join(', ')}`);
        }
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Variant fetching
  // ──────────────────────────────────────────────────────────────

  describe('Variants', function () {
    /** @type {string} */
    let complexSku;

    before(async function () {
      const products = await client.listAllProducts({ maxProducts: 30 });
      const complex = products.find((p) => p.__typename === 'ComplexProductView');
      if (!complex) this.skip();
      complexSku = complex.sku;
    });

    it('should fetch variants for a complex product', async function () {
      if (!complexSku) this.skip();

      const variants = await client.fetchVariants(complexSku);

      assert.ok(variants.length > 0, `Should have variants for ${complexSku}`);
      console.log(`    ${complexSku}: ${variants.length} variants`);

      for (const v of variants) {
        assert.ok(v.product, 'Variant should have product data');
        assert.ok(v.product.sku, 'Variant should have SKU');
        assert.ok(v.product.name, 'Variant should have name');
        assert.ok(typeof v.product.inStock === 'boolean', 'Variant should have inStock boolean');
        assert.ok(Array.isArray(v.selections), 'Variant should have selections array');
        assert.ok(v.selections.length > 0, 'Selections should not be empty');
      }
    });

    it('should have selections that map to product option UIDs', async function () {
      if (!complexSku) this.skip();

      // Get the product options
      const [product] = await client.fetchProducts([complexSku]);
      const variants = await client.fetchVariants(complexSku);

      // Collect all valid UIDs from options
      const validUids = new Set();
      for (const opt of product.options || []) {
        for (const val of opt.values || []) {
          if (val.id) validUids.add(val.id);
        }
      }

      console.log(`    Product has ${validUids.size} option UIDs`);
      assert.ok(validUids.size > 0, 'Product should have option UIDs');

      // Each variant should have at least one selection that maps to a known UID.
      // Some products have hidden single-value options whose UIDs appear in
      // selections but not in the product's options array.
      for (const v of variants) {
        const matched = v.selections.filter((uid) => validUids.has(uid));
        const unmatched = v.selections.filter((uid) => !validUids.has(uid));
        if (unmatched.length > 0) {
          console.log(`    ${v.product.sku}: ${unmatched.length} selection(s) not in options (hidden single-value option)`);
        }
        assert.ok(
          matched.length > 0,
          `Variant ${v.product.sku} should have at least one selection matching a product option UID`,
        );
      }
    });

    it('should return empty variants for a simple product', async function () {
      const products = await client.listAllProducts({ maxProducts: 30 });
      const simple = products.find((p) => p.__typename === 'SimpleProductView');
      if (!simple) this.skip();

      const variants = await client.fetchVariants(simple.sku);
      assert.strictEqual(variants.length, 0, 'Simple products should have no variants');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Normalization
  // ──────────────────────────────────────────────────────────────

  describe('Normalization', function () {
    it('should normalize a simple product from the live API', async function () {
      const products = await client.listAllProducts({ maxProducts: 10 });
      const simpleSku = products.find((p) => p.__typename === 'SimpleProductView')?.sku;
      if (!simpleSku) this.skip();

      const [product] = await client.fetchProducts([simpleSku]);
      const normalized = normalizeProduct(product, null, BASE_URL);

      assert.ok(normalized.name, 'Should have name');
      assert.ok(normalized.sku, 'Should have SKU');
      assert.ok(normalized.url, 'Should have URL');
      assert.ok(normalized.price, 'Should have price');
      assert.strictEqual(typeof normalized.price.final, 'string', 'Price final should be string');
      assert.ok(normalized.price.currency, 'Should have currency');
      assert.strictEqual(normalized.variants, undefined, 'Simple product should have no variants');

      console.log(`    ${normalized.sku}: ${normalized.name}`);
      console.log(`    Price: $${normalized.price.final} ${normalized.price.currency}`);
      console.log(`    Images: ${normalized.images?.length || 0}`);
    });

    it('should normalize a complex product with variants from the live API', async function () {
      const products = await client.listAllProducts({ maxProducts: 30 });
      const complexSku = products.find((p) => p.__typename === 'ComplexProductView')?.sku;
      if (!complexSku) this.skip();

      const [product] = await client.fetchProducts([complexSku]);
      const variants = await client.fetchVariants(complexSku);
      const normalized = normalizeProduct(product, variants, BASE_URL);

      assert.ok(normalized.name, 'Should have name');
      assert.ok(normalized.sku, 'Should have SKU');
      assert.ok(normalized.price, 'Should have price');
      assert.ok(normalized.variants?.length > 0, 'Should have variants');

      console.log(`    ${normalized.sku}: ${normalized.name}`);
      console.log(`    Variants: ${normalized.variants.length}`);

      // Check that variants have option mappings
      for (const v of normalized.variants) {
        assert.ok(v.sku, 'Variant should have SKU');
        assert.ok(v.options?.length > 0, `Variant ${v.sku} should have options`);
        for (const opt of v.options) {
          assert.ok(opt.id, 'Option should have id');
          assert.ok(opt.value, 'Option should have value');
          assert.ok(opt.uid, 'Option should have uid');
        }
        console.log(`      ${v.sku}: ${v.options.map((o) => `${o.id}=${o.value}`).join(', ')}`);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Full pipeline: API → normalize → transform → validate
  // ──────────────────────────────────────────────────────────────

  describe('Full Pipeline', function () {
    it('should produce valid Product Bus JSON for a simple product', async function () {
      const products = await client.listAllProducts({ maxProducts: 10 });
      const simpleSku = products.find((p) => p.__typename === 'SimpleProductView')?.sku;
      if (!simpleSku) this.skip();

      const [product] = await client.fetchProducts([simpleSku]);
      const normalized = normalizeProduct(product, null, BASE_URL);
      const sourceUrl = normalized.url || `${BASE_URL}/products/${product.urlKey || simpleSku.toLowerCase()}`;
      const { product: transformed, warnings, errors } = transformProduct(normalized, sourceUrl, {
        defaultCurrency: 'USD',
      });

      if (errors.length > 0) console.log(`    Errors: ${errors.join(', ')}`);
      if (warnings.length > 0) console.log(`    Warnings: ${warnings.join(', ')}`);

      assert.ok(transformed, `Should produce a product. Errors: ${errors.join(', ')}`);

      const validation = validateProduct(transformed);
      assert.ok(validation.valid, `Should be valid. Errors: ${validation.errors.join(', ')}`);

      // Required fields
      assert.ok(transformed.sku, 'Should have sku');
      assert.ok(transformed.name, 'Should have name');
      assert.ok(transformed.path, 'Should have path');
      assert.strictEqual(typeof transformed.price.final, 'string', 'price.final should be string');
      assert.strictEqual(typeof transformed.price.currency, 'string', 'price.currency should be string');

      console.log(`    ${transformed.sku}: ${transformed.name}`);
      console.log(`    Path: ${transformed.path}`);
      console.log(`    Price: $${transformed.price.final} ${transformed.price.currency}`);
    });

    it('should produce valid Product Bus JSON for a complex product with variants', async function () {
      const products = await client.listAllProducts({ maxProducts: 30 });
      const complexSku = products.find((p) => p.__typename === 'ComplexProductView')?.sku;
      if (!complexSku) this.skip();

      const [product] = await client.fetchProducts([complexSku]);
      const variantsData = await client.fetchVariants(complexSku);
      const normalized = normalizeProduct(product, variantsData, BASE_URL);
      const sourceUrl = normalized.url || `${BASE_URL}/products/${product.urlKey || complexSku.toLowerCase()}`;
      const { product: transformed, warnings, errors } = transformProduct(normalized, sourceUrl, {
        defaultCurrency: 'USD',
      });

      if (errors.length > 0) console.log(`    Errors: ${errors.join(', ')}`);
      if (warnings.length > 0) console.log(`    Warnings: ${warnings.join(', ')}`);

      assert.ok(transformed, `Should produce a product. Errors: ${errors.join(', ')}`);

      const validation = validateProduct(transformed);
      assert.ok(validation.valid, `Should be valid. Errors: ${validation.errors.join(', ')}`);

      // Variants
      assert.ok(transformed.variants?.length > 0, 'Should have variants');
      for (const v of transformed.variants) {
        assert.ok(v.sku, 'Variant should have sku');
        assert.ok(v.name, 'Variant should have name');
        assert.ok(v.url, 'Variant should have url');
        assert.ok(Array.isArray(v.images), 'Variant should have images array');
        assert.ok(v.images.length > 0, `Variant ${v.sku} should have at least one image`);
      }

      // Top-level options
      assert.ok(transformed.options?.length > 0, 'Should have top-level options');
      for (const opt of transformed.options) {
        assert.ok(opt.id, 'Option should have id');
        assert.ok(opt.label, 'Option should have label');
        assert.ok(opt.values?.length > 0, `Option "${opt.label}" should have values`);
        for (const val of opt.values) {
          assert.ok(val.value, 'Option value should have value');
          assert.ok(val.uid, 'Option value should have uid');
        }
      }

      console.log(`    ${transformed.sku}: ${transformed.name}`);
      console.log(`    Path: ${transformed.path}`);
      console.log(`    Variants: ${transformed.variants.length}`);
      console.log(`    Options: ${transformed.options.map((o) => `${o.label}(${o.values.length})`).join(', ')}`);
    });

    it('should process a batch of products end-to-end and write to disk', async function () {
      this.timeout(180000);

      if (fs.existsSync(TEST_OUTPUT)) {
        fs.rmSync(TEST_OUTPUT, { recursive: true, force: true });
      }
      fs.mkdirSync(TEST_OUTPUT, { recursive: true });

      // Discover
      const productList = await client.listAllProducts({ maxProducts: 15 });
      console.log(`    Discovered ${productList.length} products`);

      // Fetch details
      const skus = productList.map((p) => p.sku);
      const details = await client.fetchProducts(skus);
      const productMap = new Map(details.map((p) => [p.sku, p]));

      const results = { success: 0, failed: 0, skipped: 0 };

      for (const sku of skus) {
        const productView = productMap.get(sku);
        if (!productView) {
          results.skipped += 1;
          continue;
        }

        try {
          let variantsData = null;
          if (productView.__typename === 'ComplexProductView') {
            variantsData = await client.fetchVariants(sku);
          }

          const normalized = normalizeProduct(productView, variantsData, BASE_URL);
          const sourceUrl = normalized.url || `${BASE_URL}/products/${productView.urlKey || sku.toLowerCase()}`;

          const { product, errors } = transformProduct(normalized, sourceUrl, {
            defaultCurrency: 'USD',
          });

          if (!product) {
            results.failed += 1;
            console.log(`    FAIL: ${sku} — ${errors.join(', ')}`);
            continue;
          }

          // Validate
          const validation = validateProduct(product);
          assert.ok(validation.valid, `${sku} should be valid: ${validation.errors.join(', ')}`);

          // Write to disk
          const safePath = product.path.slice(1).replace(/\//g, '_');
          const outputPath = path.join(TEST_OUTPUT, `${safePath}.json`);
          fs.writeFileSync(outputPath, JSON.stringify(product, null, 2));

          results.success += 1;

          const variantCount = product.variants?.length || 0;
          const variantMsg = variantCount > 0 ? ` (${variantCount} variants)` : '';
          console.log(`    OK: ${product.name}${variantMsg}`);
        } catch (err) {
          results.failed += 1;
          console.log(`    ERROR: ${sku} — ${err.message}`);
        }
      }

      console.log(`\n    Results: ${results.success} ok, ${results.failed} failed, ${results.skipped} skipped`);
      assert.ok(results.success > 0, 'Should successfully process at least one product');
      assert.strictEqual(results.failed, 0, 'Should have no failures');

      // Verify files on disk
      const files = fs.readdirSync(TEST_OUTPUT).filter((f) => f.endsWith('.json'));
      assert.strictEqual(files.length, results.success, 'Files on disk should match success count');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Known product: ADB449 (complex with color + size)
  // ──────────────────────────────────────────────────────────────

  describe('ADB449 (Women\'s Bezier Tee)', function () {
    let product;
    let variants;

    before(async function () {
      const [p] = await client.fetchProducts(['ADB449']);
      if (!p) this.skip();
      product = p;

      if (product.__typename === 'ComplexProductView') {
        variants = await client.fetchVariants('ADB449');
      }
    });

    it('should be a ComplexProductView', function () {
      if (!product) this.skip();
      assert.strictEqual(product.__typename, 'ComplexProductView');
    });

    it('should have color and size options', function () {
      if (!product) this.skip();

      const optionIds = (product.options || []).map((o) => o.id);
      assert.ok(optionIds.includes('color'), 'Should have color option');
      assert.ok(optionIds.includes('size'), 'Should have size option');

      const colorOpt = product.options.find((o) => o.id === 'color');
      const sizeOpt = product.options.find((o) => o.id === 'size');

      console.log(`    Colors: ${colorOpt.values.map((v) => v.title).join(', ')}`);
      console.log(`    Sizes: ${sizeOpt.values.map((v) => v.title).join(', ')}`);

      assert.ok(colorOpt.values.length > 0, 'Should have color values');
      assert.ok(sizeOpt.values.length > 0, 'Should have size values');
    });

    it('should have variants with selection UIDs', function () {
      if (!variants) this.skip();

      assert.ok(variants.length > 0, 'Should have variants');
      console.log(`    ${variants.length} variants`);

      for (const v of variants) {
        assert.ok(v.selections.length >= 2, `Variant ${v.product.sku} should have at least 2 selections (color + size)`);
      }
    });

    it('should normalize with correct variant-option mapping', function () {
      if (!product || !variants) this.skip();

      const normalized = normalizeProduct(product, variants, BASE_URL);

      assert.ok(normalized.variants?.length > 0, 'Should have normalized variants');

      for (const v of normalized.variants) {
        assert.ok(v.options?.length >= 2, `Variant ${v.sku} should have at least 2 options`);

        const colorOpt = v.options.find((o) => o.id === 'color');
        const sizeOpt = v.options.find((o) => o.id === 'size');

        assert.ok(colorOpt, `Variant ${v.sku} should have color option`);
        assert.ok(sizeOpt, `Variant ${v.sku} should have size option`);
        assert.ok(colorOpt.value, 'Color option should have a value');
        assert.ok(sizeOpt.value, 'Size option should have a value');
        assert.ok(colorOpt.uid, 'Color option should have a UID');
        assert.ok(sizeOpt.uid, 'Size option should have a UID');

        console.log(`    ${v.sku}: ${colorOpt.value} / ${sizeOpt.value}`);
      }
    });

    it('should produce valid Product Bus JSON with options', function () {
      if (!product || !variants) this.skip();

      const normalized = normalizeProduct(product, variants, BASE_URL);
      const sourceUrl = normalized.url || `${BASE_URL}/products/${product.urlKey}/adb449`;
      const { product: transformed, errors } = transformProduct(normalized, sourceUrl, {
        defaultCurrency: 'USD',
      });

      assert.ok(transformed, `Should transform. Errors: ${errors.join(', ')}`);

      const validation = validateProduct(transformed);
      assert.ok(validation.valid, `Should be valid. Errors: ${validation.errors.join(', ')}`);

      // Top-level options should include color and size
      const colorOption = transformed.options?.find((o) => o.id === 'color');
      const sizeOption = transformed.options?.find((o) => o.id === 'size');

      assert.ok(colorOption, 'Should have color in top-level options');
      assert.ok(sizeOption, 'Should have size in top-level options');
      assert.ok(colorOption.values.length > 0, 'Color should have values');
      assert.ok(sizeOption.values.length > 0, 'Size should have values');

      // Each option value should have a UID
      for (const val of colorOption.values) {
        assert.ok(val.uid, `Color value "${val.value}" should have uid`);
      }
      for (const val of sizeOption.values) {
        assert.ok(val.uid, `Size value "${val.value}" should have uid`);
      }

      console.log(`    ${transformed.name}`);
      console.log(`    Path: ${transformed.path}`);
      console.log(`    Variants: ${transformed.variants.length}`);
      console.log(`    Color values: ${colorOption.values.map((v) => v.value).join(', ')}`);
      console.log(`    Size values: ${sizeOption.values.map((v) => v.value).join(', ')}`);
    });
  });
});
