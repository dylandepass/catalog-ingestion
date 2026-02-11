import { PRODUCT_SEARCH_QUERY, PRODUCTS_QUERY, VARIANTS_QUERY } from './queries.js';

const MAX_RETRIES = 3;
const PRODUCTS_BATCH_SIZE = 20;
const SEARCH_PAGE_SIZE = 50;

/**
 * Client for the Adobe Commerce Catalog Service GraphQL API.
 */
export class CatalogServiceClient {
  /**
   * @param {object} options
   * @param {string} options.endpoint - Full GraphQL endpoint URL
   * @param {string} options.environmentId - magento-environment-id
   * @param {string} [options.storeCode] - magento-store-code
   * @param {string} [options.storeViewCode] - magento-store-view-code
   * @param {string} [options.websiteCode] - magento-website-code
   * @param {string} [options.customerGroup] - magento-customer-group
   * @param {string} [options.apiKey] - x-api-key
   * @param {object} [options.logger]
   */
  constructor(options) {
    this.endpoint = options.endpoint;
    this.headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-api-key': options.apiKey || 'not_used',
    };

    if (options.environmentId) this.headers['magento-environment-id'] = options.environmentId;
    if (options.storeCode) this.headers['magento-store-code'] = options.storeCode;
    if (options.storeViewCode) this.headers['magento-store-view-code'] = options.storeViewCode;
    if (options.websiteCode) this.headers['magento-website-code'] = options.websiteCode;
    if (options.customerGroup) this.headers['magento-customer-group'] = options.customerGroup;

    this.logger = options.logger;
  }

  /**
   * Execute a GraphQL query with retry logic.
   *
   * @param {string} query - GraphQL query string
   * @param {object} [variables] - Query variables
   * @returns {Promise<object>} Response data
   */
  async query(query, variables = {}) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ query, variables }),
        });

        if (response.status === 429 || response.status >= 500) {
          const backoff = Math.min(1000 * (2 ** attempt) + Math.random() * 500, 30000);
          if (this.logger) {
            this.logger.debug(`Rate limited/server error (${response.status}), retrying in ${Math.round(backoff)}ms...`);
          }
          await new Promise((resolve) => { setTimeout(resolve, backoff); });
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        }

        const result = await response.json();

        if (result.errors?.length > 0) {
          const messages = result.errors.map((e) => e.message).join('; ');
          throw new Error(`GraphQL errors: ${messages}`);
        }

        return result.data;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES && err.message?.includes('fetch')) {
          const backoff = 1000 * (2 ** attempt);
          await new Promise((resolve) => { setTimeout(resolve, backoff); });
        }
      }
    }

    throw lastError;
  }

  /**
   * List all products via paginated productSearch.
   * Returns an array of { sku, name, urlKey, __typename } for every product.
   *
   * @param {{ maxProducts?: number, onPage?: (pageNum: number, totalPages: number) => void }} [options]
   * @returns {Promise<object[]>}
   */
  async listAllProducts(options = {}) {
    const { maxProducts, onPage } = options;
    const allProducts = [];
    let currentPage = 1;
    let totalPages = 1;

    do {
      const data = await this.query(PRODUCT_SEARCH_QUERY, {
        pageSize: SEARCH_PAGE_SIZE,
        currentPage: currentPage,
      });

      const search = data.productSearch;
      totalPages = search.page_info.total_pages;

      if (onPage) onPage(currentPage, totalPages);

      for (const item of search.items) {
        if (item.productView) {
          allProducts.push(item.productView);
        }
        if (maxProducts && allProducts.length >= maxProducts) {
          return allProducts.slice(0, maxProducts);
        }
      }

      currentPage += 1;
    } while (currentPage <= totalPages);

    return allProducts;
  }

  /**
   * Fetch full product details for an array of SKUs.
   * Automatically batches into groups to stay within query limits.
   *
   * @param {string[]} skus
   * @param {{ onBatch?: (batchNum: number, totalBatches: number) => void }} [options]
   * @returns {Promise<object[]>} Array of ProductView objects
   */
  async fetchProducts(skus, options = {}) {
    const { onBatch } = options;
    const results = [];

    // Split into batches
    const batches = [];
    for (let i = 0; i < skus.length; i += PRODUCTS_BATCH_SIZE) {
      batches.push(skus.slice(i, i + PRODUCTS_BATCH_SIZE));
    }

    for (let i = 0; i < batches.length; i += 1) {
      if (onBatch) onBatch(i + 1, batches.length);

      const data = await this.query(PRODUCTS_QUERY, { skus: batches[i] });
      if (data.products) {
        results.push(...data.products);
      }
    }

    return results;
  }

  /**
   * Fetch variants for a single complex product.
   *
   * @param {string} sku
   * @returns {Promise<object[]>} Array of { selections, product } objects
   */
  async fetchVariants(sku) {
    const data = await this.query(VARIANTS_QUERY, { sku });
    return data.variants?.variants || [];
  }
}
