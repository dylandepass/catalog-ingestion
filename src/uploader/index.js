import fs from 'node:fs';
import path from 'node:path';
import { validateProduct } from '../utils/validation.js';

const MAX_BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;

/**
 * Upload products to the Product Bus API.
 */
export class ProductBusUploader {
  /**
   * @param {{
   *   org: string,
   *   site: string,
   *   apiKey: string,
   *   apiUrl?: string,
   *   batchSize?: number,
   *   dryRun?: boolean,
   *   logger?: object,
   * }} options
   */
  constructor(options) {
    this.org = options.org;
    this.site = options.site;
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl || 'https://api.adobecommerce.live';
    this.batchSize = Math.min(options.batchSize || MAX_BATCH_SIZE, MAX_BATCH_SIZE);
    this.dryRun = options.dryRun || false;
    this.logger = options.logger;
  }

  /**
   * Upload a single batch of products (max 50).
   * @param {object[]} products
   * @returns {Promise<{ success: boolean, statusCode?: number, body?: object, error?: string }>}
   */
  async uploadBatch(products) {
    if (products.length > MAX_BATCH_SIZE) {
      return { success: false, error: `Batch exceeds max size of ${MAX_BATCH_SIZE}` };
    }

    const url = `${this.apiUrl}/${this.org}/sites/${this.site}/catalog/*`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(products),
        });

        const body = await res.json().catch(() => null);

        if (res.ok) {
          return { success: true, statusCode: res.status, body };
        }

        // Auth failures — don't retry
        if (res.status === 401 || res.status === 403) {
          return {
            success: false,
            statusCode: res.status,
            body,
            error: `Authentication failed (${res.status})`,
          };
        }

        // Rate limited — retry with backoff
        if (res.status === 429) {
          if (attempt < MAX_RETRIES) {
            const delay = retryDelay(attempt);
            if (this.logger) this.logger.warn(`Rate limited, retrying in ${delay}ms...`);
            await sleep(delay);
            continue;
          }
        }

        // Server error — retry with backoff
        if (res.status >= 500) {
          if (attempt < MAX_RETRIES) {
            const delay = retryDelay(attempt);
            if (this.logger) this.logger.warn(`Server error ${res.status}, retrying in ${delay}ms...`);
            await sleep(delay);
            continue;
          }
        }

        // Client error — don't retry
        return {
          success: false,
          statusCode: res.status,
          body,
          error: body?.error || `HTTP ${res.status}`,
        };
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const delay = retryDelay(attempt);
          if (this.logger) this.logger.warn(`Network error, retrying in ${delay}ms: ${err.message}`);
          await sleep(delay);
          continue;
        }
        return { success: false, error: `Network error: ${err.message}` };
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  /**
   * Upload all products from an input directory.
   * @param {string} inputDir
   * @param {{ onProgress?: (done: number, total: number) => void }} [options]
   * @returns {Promise<{ total: number, uploaded: number, failed: number, skipped: number, errors: string[] }>}
   */
  async uploadAll(inputDir, options = {}) {
    const { onProgress } = options;

    // Find all JSON files
    const files = findJsonFiles(inputDir);
    if (this.logger) this.logger.info(`Found ${files.length} product files in ${inputDir}`);

    // Read and validate all products
    const products = [];
    const skipped = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const product = JSON.parse(content);
        const validation = validateProduct(product);
        if (validation.valid) {
          products.push(product);
        } else {
          skipped.push({ file, errors: validation.errors });
          if (this.logger) {
            this.logger.warn(`Skipping invalid product ${file}: ${validation.errors.join(', ')}`);
          }
        }
      } catch (err) {
        skipped.push({ file, errors: [err.message] });
        if (this.logger) this.logger.warn(`Failed to read ${file}: ${err.message}`);
      }
    }

    if (this.dryRun) {
      if (this.logger) {
        this.logger.info(`Dry run: ${products.length} valid, ${skipped.length} skipped`);
      }
      return {
        total: files.length,
        uploaded: 0,
        failed: 0,
        skipped: skipped.length,
        errors: skipped.map((s) => `${s.file}: ${s.errors.join(', ')}`),
      };
    }

    // Chunk and upload
    const batches = chunk(products, this.batchSize);
    let uploaded = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      if (this.logger) this.logger.debug(`Uploading batch ${i + 1}/${batches.length} (${batch.length} products)`);

      // eslint-disable-next-line no-await-in-loop
      const result = await this.uploadBatch(batch);
      if (result.success) {
        uploaded += batch.length;
      } else {
        failed += batch.length;
        errors.push(`Batch ${i + 1}: ${result.error}`);
        if (this.logger) this.logger.error(`Batch ${i + 1} failed: ${result.error}`);

        // Abort on auth failures
        if (result.statusCode === 401 || result.statusCode === 403) {
          errors.push('Aborting: authentication failure');
          break;
        }
      }

      if (onProgress) onProgress(uploaded + failed, products.length);
    }

    return {
      total: files.length,
      uploaded,
      failed,
      skipped: skipped.length,
      errors: [
        ...errors,
        ...skipped.map((s) => `Skipped ${s.file}: ${s.errors.join(', ')}`),
      ],
    };
  }
}

/**
 * Recursively find all .json files in a directory.
 */
function findJsonFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Split an array into chunks.
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Calculate retry delay with exponential backoff + jitter.
 */
function retryDelay(attempt) {
  return BASE_RETRY_DELAY * (2 ** attempt) + Math.floor(Math.random() * 1000);
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}
