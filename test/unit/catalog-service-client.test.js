import assert from 'node:assert';
import sinon from 'sinon';
import { CatalogServiceClient } from '../../src/catalog-service/client.js';

describe('CatalogServiceClient', function () {
  let client;
  let fetchStub;

  beforeEach(function () {
    client = new CatalogServiceClient({
      endpoint: 'https://edge-graph.adobe.io/api/test-id/graphql',
      environmentId: 'test-env',
      storeCode: 'main_website_store',
      storeViewCode: 'default',
      websiteCode: 'base',
      customerGroup: 'test-group',
      apiKey: 'test-key',
    });
    fetchStub = sinon.stub(global, 'fetch');
  });

  afterEach(function () {
    fetchStub.restore();
  });

  function jsonResponse(data, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
    });
  }

  // ──────────────────────────────────────────────────────────────
  // Constructor / headers
  // ──────────────────────────────────────────────────────────────

  describe('constructor', function () {
    it('should set required headers', function () {
      assert.strictEqual(client.headers['content-type'], 'application/json');
      assert.strictEqual(client.headers.accept, 'application/json');
      assert.strictEqual(client.headers['magento-environment-id'], 'test-env');
      assert.strictEqual(client.headers['magento-store-code'], 'main_website_store');
      assert.strictEqual(client.headers['magento-store-view-code'], 'default');
      assert.strictEqual(client.headers['magento-website-code'], 'base');
      assert.strictEqual(client.headers['magento-customer-group'], 'test-group');
      assert.strictEqual(client.headers['x-api-key'], 'test-key');
    });

    it('should omit optional headers when not provided', function () {
      const minimal = new CatalogServiceClient({
        endpoint: 'https://example.com/graphql',
      });
      assert.strictEqual(minimal.headers['magento-environment-id'], undefined);
      assert.strictEqual(minimal.headers['magento-customer-group'], undefined);
      assert.strictEqual(minimal.headers['x-api-key'], 'not_used');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // query()
  // ──────────────────────────────────────────────────────────────

  describe('query()', function () {
    it('should make a POST request with correct body', async function () {
      fetchStub.returns(jsonResponse({ data: { products: [] } }));

      await client.query('query { products }', { skus: ['A'] });

      assert.ok(fetchStub.calledOnce);
      const [url, opts] = fetchStub.firstCall.args;
      assert.strictEqual(url, 'https://edge-graph.adobe.io/api/test-id/graphql');
      assert.strictEqual(opts.method, 'POST');

      const body = JSON.parse(opts.body);
      assert.strictEqual(body.query, 'query { products }');
      assert.deepStrictEqual(body.variables, { skus: ['A'] });
    });

    it('should return data from response', async function () {
      fetchStub.returns(jsonResponse({ data: { products: [{ sku: 'A' }] } }));

      const result = await client.query('query { products }');
      assert.deepStrictEqual(result, { products: [{ sku: 'A' }] });
    });

    it('should throw on GraphQL errors', async function () {
      fetchStub.returns(jsonResponse({
        data: null,
        errors: [{ message: 'Field not found' }, { message: 'Bad request' }],
      }));

      await assert.rejects(
        () => client.query('query { bad }'),
        (err) => {
          assert.ok(err.message.includes('Field not found'));
          assert.ok(err.message.includes('Bad request'));
          return true;
        },
      );
    });

    it('should throw on non-ok HTTP status', async function () {
      fetchStub.returns(jsonResponse({}, 400));

      await assert.rejects(
        () => client.query('query { bad }'),
        (err) => {
          assert.ok(err.message.includes('400'));
          return true;
        },
      );
    });

    it('should retry on 429 status', async function () {
      this.timeout(30000);
      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

      try {
        // First call returns 429, second returns success
        fetchStub.onCall(0).returns(jsonResponse({}, 429));
        fetchStub.onCall(1).returns(jsonResponse({ data: { ok: true } }));

        const promise = client.query('query { test }');
        // Advance past the backoff delay
        await clock.tickAsync(10000);
        const result = await promise;

        assert.deepStrictEqual(result, { ok: true });
        assert.strictEqual(fetchStub.callCount, 2);
      } finally {
        clock.restore();
      }
    });

    it('should retry on 500 status', async function () {
      this.timeout(30000);
      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

      try {
        fetchStub.onCall(0).returns(jsonResponse({}, 500));
        fetchStub.onCall(1).returns(jsonResponse({ data: { ok: true } }));

        const promise = client.query('query { test }');
        await clock.tickAsync(10000);
        const result = await promise;

        assert.deepStrictEqual(result, { ok: true });
        assert.strictEqual(fetchStub.callCount, 2);
      } finally {
        clock.restore();
      }
    });

    it('should fail after max retries on persistent server errors', async function () {
      this.timeout(30000);
      const clock = sinon.useFakeTimers({ shouldAdvanceTime: true });

      try {
        fetchStub.returns(jsonResponse({}, 500));

        const promise = client.query('query { test }');
        await clock.tickAsync(60000);

        await assert.rejects(
          () => promise,
          (err) => {
            assert.ok(err.message.includes('500'));
            return true;
          },
        );
        assert.strictEqual(fetchStub.callCount, 3); // MAX_RETRIES = 3
      } finally {
        clock.restore();
      }
    });
  });

  // ──────────────────────────────────────────────────────────────
  // listAllProducts()
  // ──────────────────────────────────────────────────────────────

  describe('listAllProducts()', function () {
    it('should paginate through all products', async function () {
      // Page 1: 2 products, total_pages = 2
      fetchStub.onCall(0).returns(jsonResponse({
        data: {
          productSearch: {
            items: [
              { productView: { sku: 'SKU-1', name: 'Product 1', urlKey: 'p1', __typename: 'SimpleProductView' } },
              { productView: { sku: 'SKU-2', name: 'Product 2', urlKey: 'p2', __typename: 'SimpleProductView' } },
            ],
            page_info: { current_page: 1, page_size: 2, total_pages: 2 },
            total_count: 3,
          },
        },
      }));

      // Page 2: 1 product
      fetchStub.onCall(1).returns(jsonResponse({
        data: {
          productSearch: {
            items: [
              { productView: { sku: 'SKU-3', name: 'Product 3', urlKey: 'p3', __typename: 'ComplexProductView' } },
            ],
            page_info: { current_page: 2, page_size: 2, total_pages: 2 },
            total_count: 3,
          },
        },
      }));

      const products = await client.listAllProducts();

      assert.strictEqual(products.length, 3);
      assert.strictEqual(products[0].sku, 'SKU-1');
      assert.strictEqual(products[2].sku, 'SKU-3');
      assert.strictEqual(fetchStub.callCount, 2);
    });

    it('should respect maxProducts limit', async function () {
      fetchStub.returns(jsonResponse({
        data: {
          productSearch: {
            items: [
              { productView: { sku: 'A', name: 'A', urlKey: 'a', __typename: 'SimpleProductView' } },
              { productView: { sku: 'B', name: 'B', urlKey: 'b', __typename: 'SimpleProductView' } },
              { productView: { sku: 'C', name: 'C', urlKey: 'c', __typename: 'SimpleProductView' } },
            ],
            page_info: { current_page: 1, page_size: 50, total_pages: 5 },
            total_count: 200,
          },
        },
      }));

      const products = await client.listAllProducts({ maxProducts: 2 });

      assert.strictEqual(products.length, 2);
      assert.strictEqual(products[0].sku, 'A');
      assert.strictEqual(products[1].sku, 'B');
      // Should NOT request page 2 since we already hit the limit
      assert.strictEqual(fetchStub.callCount, 1);
    });

    it('should call onPage callback', async function () {
      fetchStub.returns(jsonResponse({
        data: {
          productSearch: {
            items: [
              { productView: { sku: 'A', name: 'A', urlKey: 'a', __typename: 'SimpleProductView' } },
            ],
            page_info: { current_page: 1, page_size: 50, total_pages: 1 },
            total_count: 1,
          },
        },
      }));

      const pages = [];
      await client.listAllProducts({ onPage: (page, total) => pages.push({ page, total }) });

      assert.strictEqual(pages.length, 1);
      assert.deepStrictEqual(pages[0], { page: 1, total: 1 });
    });

    it('should skip items without productView', async function () {
      fetchStub.returns(jsonResponse({
        data: {
          productSearch: {
            items: [
              { productView: { sku: 'A', name: 'A', urlKey: 'a', __typename: 'SimpleProductView' } },
              { productView: null },
              {},
            ],
            page_info: { current_page: 1, page_size: 50, total_pages: 1 },
            total_count: 3,
          },
        },
      }));

      const products = await client.listAllProducts();
      assert.strictEqual(products.length, 1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // fetchProducts()
  // ──────────────────────────────────────────────────────────────

  describe('fetchProducts()', function () {
    it('should fetch a batch of products', async function () {
      fetchStub.returns(jsonResponse({
        data: {
          products: [
            { sku: 'A', name: 'Product A', __typename: 'SimpleProductView' },
            { sku: 'B', name: 'Product B', __typename: 'ComplexProductView' },
          ],
        },
      }));

      const products = await client.fetchProducts(['A', 'B']);
      assert.strictEqual(products.length, 2);
      assert.strictEqual(products[0].sku, 'A');
      assert.strictEqual(products[1].sku, 'B');
    });

    it('should split large SKU lists into batches of 20', async function () {
      const skus = Array.from({ length: 45 }, (_, i) => `SKU-${i}`);

      fetchStub.returns(jsonResponse({ data: { products: [] } }));

      await client.fetchProducts(skus);

      // 45 SKUs / 20 per batch = 3 batches
      assert.strictEqual(fetchStub.callCount, 3);

      // Verify batch sizes from request bodies
      const batch1 = JSON.parse(fetchStub.getCall(0).args[1].body);
      const batch2 = JSON.parse(fetchStub.getCall(1).args[1].body);
      const batch3 = JSON.parse(fetchStub.getCall(2).args[1].body);
      assert.strictEqual(batch1.variables.skus.length, 20);
      assert.strictEqual(batch2.variables.skus.length, 20);
      assert.strictEqual(batch3.variables.skus.length, 5);
    });

    it('should call onBatch callback', async function () {
      fetchStub.returns(jsonResponse({ data: { products: [] } }));

      const batches = [];
      await client.fetchProducts(
        Array.from({ length: 25 }, (_, i) => `SKU-${i}`),
        { onBatch: (num, total) => batches.push({ num, total }) },
      );

      assert.strictEqual(batches.length, 2);
      assert.deepStrictEqual(batches[0], { num: 1, total: 2 });
      assert.deepStrictEqual(batches[1], { num: 2, total: 2 });
    });

    it('should handle empty products response', async function () {
      fetchStub.returns(jsonResponse({ data: { products: null } }));

      const products = await client.fetchProducts(['NONEXISTENT']);
      assert.strictEqual(products.length, 0);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // fetchVariants()
  // ──────────────────────────────────────────────────────────────

  describe('fetchVariants()', function () {
    it('should fetch variants for a SKU', async function () {
      fetchStub.returns(jsonResponse({
        data: {
          variants: {
            variants: [
              {
                selections: ['uid-1', 'uid-2'],
                product: { sku: 'A-VAR1', name: 'Variant 1', inStock: true },
              },
              {
                selections: ['uid-1', 'uid-3'],
                product: { sku: 'A-VAR2', name: 'Variant 2', inStock: false },
              },
            ],
          },
        },
      }));

      const variants = await client.fetchVariants('A');
      assert.strictEqual(variants.length, 2);
      assert.strictEqual(variants[0].product.sku, 'A-VAR1');
      assert.deepStrictEqual(variants[0].selections, ['uid-1', 'uid-2']);
    });

    it('should return empty array when no variants', async function () {
      fetchStub.returns(jsonResponse({ data: { variants: { variants: [] } } }));
      const variants = await client.fetchVariants('SIMPLE-SKU');
      assert.strictEqual(variants.length, 0);
    });

    it('should return empty array when variants field is null', async function () {
      fetchStub.returns(jsonResponse({ data: { variants: null } }));
      const variants = await client.fetchVariants('SIMPLE-SKU');
      assert.strictEqual(variants.length, 0);
    });
  });
});
