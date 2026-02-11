#!/usr/bin/env node

/**
 * Adds category data to product JSON files based on Adobe Commerce categoryIds.
 * Uses productSearch with categoryIds filter to map each product to its categories,
 * then writes the category paths into custom.categories on each product.
 */

import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = path.resolve(import.meta.dirname, '..', 'output', 'products');

const ENDPOINT = 'https://edge-graph.adobe.io/api/b8226c70-6dad-4c85-a17b-9b0a3fc3abe2/graphql';
const HEADERS = {
  'content-type': 'application/json',
  'magento-environment-id': 'VyumfC53bDYkVB6b8MXsJh',
  'magento-store-code': 'main_website_store',
  'magento-store-view-code': 'default',
  'magento-website-code': 'base',
  'magento-customer-group': 'b6589fc6ab0dc82cf12099d1c2d40ab994e8410c',
  'x-api-key': 'not_used',
};

// Category ID → path mapping derived from Adobe Store site
const CATEGORY_MAP = {
  3: 'apparel',
  4: 'apparel/shirts',
  5: 'apparel/outerwear',
  6: 'apparel/hats',
  7: 'apparel/accessories',
  8: 'apparel/youth',
  9: 'employee-networks',
  10: 'staff-events',
  11: 'office',
  12: 'office/tech',
  13: 'office/desk-accessories',
  14: 'lifestyle',
  15: 'lifestyle/drinkware',
  16: 'lifestyle/home-decor',
  17: 'lifestyle/outdoor-recreation',
  18: 'lifestyle/pillows',
  19: 'lifestyle/travel',
  20: 'bags',
  21: 'bags/backpacks',
  22: 'bags/totes-pouches',
  23: 'collections',
  24: 'collections/adobe-max',
  25: 'collections/artist-collaborations',
  26: 'collections/creative-apps',
  27: 'collections/gifts',
  28: 'collections/entertaining',
  29: 'collections/sustainability',
  30: 'collections/employee-networks',
  31: 'collections/staff-events',
  32: 'all-products',
  33: 'featured',
  34: 'gift-cards',
  35: 'office/journals',
  36: 'office/pens',
  37: 'office/pins-stickers',
};

// ─── Fetch SKUs per category from API ────────────────────────────

async function fetchCategorySkus(categoryId) {
  const skus = [];
  let page = 1;
  while (true) {
    const body = JSON.stringify({
      query: `{ productSearch(phrase: " ", page_size: 50, current_page: ${page}, filter: [{attribute: "categoryIds", eq: "${categoryId}"}]) { items { productView { sku } } page_info { total_pages } } }`,
    });
    const res = await fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body });
    const data = await res.json();
    const items = data.data?.productSearch?.items || [];
    skus.push(...items.map((i) => i.productView?.sku).filter(Boolean));
    const totalPages = data.data?.productSearch?.page_info?.total_pages || 1;
    if (page >= totalPages) break;
    page++;
  }
  return skus;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  // Build SKU → category paths map from the API
  console.log('Fetching category assignments from API...');
  const skuCategories = new Map();

  for (const [catId, catPath] of Object.entries(CATEGORY_MAP)) {
    const skus = await fetchCategorySkus(catId);
    for (const sku of skus) {
      if (!skuCategories.has(sku)) skuCategories.set(sku, []);
      skuCategories.get(sku).push(catPath);
    }
    if (skus.length > 0) {
      process.stdout.write(`  ${catPath}: ${skus.length} products\n`);
    }
  }

  console.log(`\nMapped ${skuCategories.size} SKUs to categories`);

  // Load product files and update
  const dirs = fs.readdirSync(OUTPUT_DIR);
  let updated = 0;
  let noCategories = 0;

  for (const dir of dirs) {
    const dirPath = path.join(OUTPUT_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    if (files.length === 0) continue;

    const filePath = path.join(dirPath, files[0]);
    const product = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const categories = skuCategories.get(product.sku);

    if (!categories || categories.length === 0) {
      noCategories++;
      console.log(`  No categories for: ${product.sku} (${product.name})`);
      continue;
    }

    // Filter out meta-categories, keep meaningful ones
    // Sort: most specific (longest path) first
    const meaningful = categories
      .filter((c) => c !== 'all-products' && c !== 'featured')
      .sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b));

    if (!product.custom) product.custom = {};
    product.custom.categories = meaningful;

    fs.writeFileSync(filePath, JSON.stringify(product, null, 2) + '\n');
    updated++;
  }

  console.log(`\nUpdated ${updated} products with categories`);
  if (noCategories > 0) console.log(`${noCategories} products had no category mapping`);
}

main().catch(console.error);
