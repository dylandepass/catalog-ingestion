#!/usr/bin/env node

/**
 * Convert products.csv back to Product Bus JSON and upload via bulk API.
 *
 * Usage:
 *   node csv-to-product-bus.js \
 *     --csv products.csv \
 *     --org adobestore \
 *     --site main \
 *     --api-key {your-api-key} \
 *     [--api-url https://api.adobecommerce.live] \
 *     [--batch-size 50] \
 *     [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;
const NUM_IMAGE_COLS = 10;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

function hasFlag(name) {
  return args.includes(name);
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`
Usage: node csv-to-product-bus.js [options]

Options:
  --csv <file>        Path to products.csv (default: products.csv)
  --org <org>         Organization slug (required unless --dry-run)
  --site <site>       Site slug (required unless --dry-run)
  --api-key <key>     API bearer token (required unless --dry-run)
  --api-url <url>     API base URL (default: https://api.adobecommerce.live)
  --batch-size <n>    Products per batch, max 50 (default: 50)
  --dry-run           Validate and show output without uploading
  --help, -h          Show this help
`);
  process.exit(0);
}

const csvFile = path.resolve(__dirname, getArg('--csv', 'products.csv'));
const org = getArg('--org', '');
const site = getArg('--site', '');
const apiKey = getArg('--api-key', '');
const apiUrl = getArg('--api-url', 'https://api.adobecommerce.live');
const batchSize = Math.min(parseInt(getArg('--batch-size', '50'), 10) || 50, MAX_BATCH_SIZE);
const dryRun = hasFlag('--dry-run');

if (!dryRun && (!org || !site || !apiKey)) {
  console.error('Error: --org, --site, and --api-key are required (or use --dry-run)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CSV parser (RFC 4180)
// ---------------------------------------------------------------------------

/**
 * Parse a CSV string into an array of objects keyed by header names.
 */
function parseCSV(text) {
  const rows = [];
  let pos = 0;

  function parseField() {
    if (pos >= text.length) return '';

    // Quoted field
    if (text[pos] === '"') {
      pos += 1; // skip opening quote
      let value = '';
      while (pos < text.length) {
        if (text[pos] === '"') {
          if (pos + 1 < text.length && text[pos + 1] === '"') {
            // Escaped quote
            value += '"';
            pos += 2;
          } else {
            // End of quoted field
            pos += 1; // skip closing quote
            break;
          }
        } else {
          value += text[pos];
          pos += 1;
        }
      }
      return value;
    }

    // Unquoted field
    let value = '';
    while (pos < text.length && text[pos] !== ',' && text[pos] !== '\n' && text[pos] !== '\r') {
      value += text[pos];
      pos += 1;
    }
    return value;
  }

  function parseRow() {
    const fields = [];
    while (pos < text.length) {
      fields.push(parseField());

      if (pos >= text.length) break;

      if (text[pos] === ',') {
        pos += 1; // skip comma
        continue;
      }

      // End of row
      if (text[pos] === '\r') pos += 1;
      if (text[pos] === '\n') pos += 1;
      break;
    }
    return fields;
  }

  // Parse header
  const headers = parseRow();
  if (headers.length === 0) return [];

  // Parse data rows
  while (pos < text.length) {
    // Skip empty lines at end
    if (text[pos] === '\n' || text[pos] === '\r') {
      pos += 1;
      continue;
    }
    const fields = parseRow();
    if (fields.length === 0) continue;

    const obj = {};
    for (let i = 0; i < headers.length; i += 1) {
      obj[headers[i]] = fields[i] || '';
    }
    rows.push(obj);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Product Bus JSON assembly
// ---------------------------------------------------------------------------

/**
 * Build images array from image_1..image_10 + image_1_roles..image_10_roles columns.
 */
function buildImages(row) {
  const images = [];
  for (let i = 1; i <= NUM_IMAGE_COLS; i += 1) {
    const url = row[`image_${i}`];
    if (!url) continue;
    const img = { url };
    const roles = row[`image_${i}_roles`];
    if (roles) {
      img.roles = roles.split('|').filter(Boolean);
    }
    images.push(img);
  }
  return images;
}

/**
 * Build a price object from row fields.
 */
function buildPrice(row) {
  if (!row.price_currency && !row.price_regular && !row.price_final) return undefined;
  const price = {};
  if (row.price_currency) price.currency = row.price_currency;
  if (row.price_regular) price.regular = row.price_regular;
  if (row.price_final) price.final = row.price_final;
  return price;
}

/**
 * Assemble a complete Product Bus JSON object from a parent row and its variant rows.
 */
function assembleProduct(parentRow, variantRows) {
  const product = {
    path: parentRow.path,
    sku: parentRow.sku,
    name: parentRow.name,
  };

  if (parentRow.url) product.url = parentRow.url;
  if (parentRow.description) product.description = parentRow.description;
  if (parentRow.meta_title) product.metaTitle = parentRow.meta_title;
  if (parentRow.meta_description) product.metaDescription = parentRow.meta_description;

  const price = buildPrice(parentRow);
  if (price) product.price = price;

  if (parentRow.availability) product.availability = parentRow.availability;

  const images = buildImages(parentRow);
  if (images.length > 0) product.images = images;

  // Variants
  if (variantRows.length > 0) {
    product.variants = variantRows.map((row) => {
      const variant = {
        sku: row.sku,
        name: row.name,
      };

      if (row.url) variant.url = row.url;

      const vImages = buildImages(row);
      if (vImages.length > 0) variant.images = vImages;

      const vPrice = buildPrice(row);
      if (vPrice) variant.price = vPrice;

      if (row.availability) variant.availability = row.availability;

      // Options
      const options = [];
      if (row.option_size) {
        const opt = { id: 'size', value: row.option_size };
        if (row.option_size_uid) opt.uid = row.option_size_uid;
        options.push(opt);
      }
      if (row.option_color) {
        const opt = { id: 'color', value: row.option_color };
        if (row.option_color_uid) opt.uid = row.option_color_uid;
        options.push(opt);
      }
      if (options.length > 0) variant.options = options;

      return variant;
    });

    // Reconstruct top-level options from variant data
    product.options = buildTopLevelOptions(variantRows);
  }

  // Custom fields
  const custom = {};
  if (parentRow.related) {
    custom.related = parentRow.related.split('|').filter(Boolean);
  }
  if (parentRow.categories) {
    custom.categories = parentRow.categories.split('|').filter(Boolean);
  }
  if (Object.keys(custom).length > 0) product.custom = custom;

  return product;
}

/**
 * Reconstruct the top-level options array from variant rows.
 * Derives unique values and their UIDs for each option type.
 */
function buildTopLevelOptions(variantRows) {
  const optionMap = new Map(); // id -> Map<value, uid>

  for (const row of variantRows) {
    if (row.option_size) {
      if (!optionMap.has('size')) optionMap.set('size', new Map());
      optionMap.get('size').set(row.option_size, row.option_size_uid || '');
    }
    if (row.option_color) {
      if (!optionMap.has('color')) optionMap.set('color', new Map());
      optionMap.get('color').set(row.option_color, row.option_color_uid || '');
    }
  }

  const options = [];
  let position = 1;

  for (const [id, valuesMap] of optionMap) {
    const opt = {
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      position,
      values: [...valuesMap.entries()].map(([value, uid]) => {
        const v = { value };
        if (uid) v.uid = uid;
        return v;
      }),
    };
    options.push(opt);
    position += 1;
  }

  return options;
}

// ---------------------------------------------------------------------------
// Batch upload with retry
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function retryDelay(attempt) {
  return BASE_RETRY_DELAY * (2 ** attempt) + Math.floor(Math.random() * 1000);
}

/**
 * Upload a single batch of products.
 */
async function uploadBatch(products) {
  const url = `${apiUrl}/${org}/sites/${site}/catalog/*`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
        return { success: false, statusCode: res.status, error: `Auth failed (${res.status})` };
      }

      // Rate limited or server error — retry
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const delay = retryDelay(attempt);
        console.log(`  Retrying in ${delay}ms (HTTP ${res.status})...`);
        await sleep(delay);
        continue;
      }

      return { success: false, statusCode: res.status, error: body?.error || `HTTP ${res.status}` };
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delay = retryDelay(attempt);
        console.log(`  Network error, retrying in ${delay}ms: ${err.message}`);
        await sleep(delay);
        continue;
      }
      return { success: false, error: `Network error: ${err.message}` };
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Reading CSV: ${csvFile}`);
  const text = fs.readFileSync(csvFile, 'utf-8');
  const rows = parseCSV(text);
  console.log(`Parsed ${rows.length} rows`);

  // Group rows by parent
  const products = [];
  let currentParent = null;
  let currentVariants = [];

  for (const row of rows) {
    if (row.type === 'parent') {
      // Flush previous product
      if (currentParent) {
        products.push(assembleProduct(currentParent, currentVariants));
      }
      currentParent = row;
      currentVariants = [];
    } else if (row.type === 'variant') {
      currentVariants.push(row);
    }
  }
  // Flush last product
  if (currentParent) {
    products.push(assembleProduct(currentParent, currentVariants));
  }

  console.log(`Assembled ${products.length} products`);

  // Validate
  const errors = [];
  for (const product of products) {
    if (!product.sku) errors.push('Missing SKU in a product');
    if (!product.name) errors.push(`Missing name for SKU ${product.sku}`);
    if (!product.path) errors.push(`Missing path for SKU ${product.sku}`);
  }

  if (errors.length > 0) {
    console.error(`Validation errors:`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log(`All ${products.length} products valid`);

  if (dryRun) {
    console.log('\n--- DRY RUN ---');
    console.log(`Would upload ${products.length} products in ${Math.ceil(products.length / batchSize)} batches`);
    console.log(`API: POST ${apiUrl}/${org || '{org}'}/sites/${site || '{site}'}/catalog/*`);
    console.log('\nSample product (first):');
    console.log(JSON.stringify(products[0], null, 2));
    return;
  }

  // Upload in batches
  const batches = [];
  for (let i = 0; i < products.length; i += batchSize) {
    batches.push(products.slice(i, i + batchSize));
  }

  console.log(`\nUploading ${products.length} products in ${batches.length} batches (size ${batchSize})`);
  console.log(`API: POST ${apiUrl}/${org}/sites/${site}/catalog/*\n`);

  let uploaded = 0;
  let failed = 0;
  const failedSkus = [];

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const skus = batch.map((p) => p.sku).join(', ');
    process.stdout.write(`Batch ${i + 1}/${batches.length} (${batch.length} products)... `);

    const result = await uploadBatch(batch);
    if (result.success) {
      uploaded += batch.length;
      console.log('OK');
    } else {
      failed += batch.length;
      failedSkus.push(...batch.map((p) => p.sku));
      console.log(`FAILED: ${result.error}`);

      if (result.statusCode === 401 || result.statusCode === 403) {
        console.error('Aborting: authentication failure');
        break;
      }
    }
  }

  console.log(`\n--- Results ---`);
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Failed: ${failed}`);
  if (failedSkus.length > 0) {
    console.log(`Failed SKUs: ${failedSkus.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
