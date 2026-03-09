#!/usr/bin/env node

/**
 * One-time script to convert all product JSON files into a single products.csv.
 *
 * Usage:
 *   node generate-csv.js [--input ../output/products] [--output products.csv]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NUM_IMAGE_COLS = 10;

const COLUMNS = [
  'type',
  'sku',
  'parent_sku',
  'name',
  'path',
  'url',
  'description',
  'meta_title',
  'meta_description',
  'price_currency',
  'price_regular',
  'price_final',
  'availability',
  // image_1 .. image_10 + image_1_roles .. image_10_roles
  ...Array.from({ length: NUM_IMAGE_COLS }, (_, i) => `image_${i + 1}`),
  ...Array.from({ length: NUM_IMAGE_COLS }, (_, i) => `image_${i + 1}_roles`),
  'option_size',
  'option_color',
  'option_size_uid',
  'option_color_uid',
  'categories',
  'related',
];

/**
 * Escape a value for CSV (RFC 4180).
 */
function csvEscape(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Recursively find all .json files in a directory.
 */
function findJsonFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

/**
 * Build image columns for a row from an images array.
 */
function imageColumns(images) {
  const cols = {};
  const imgs = images || [];
  for (let i = 0; i < NUM_IMAGE_COLS; i += 1) {
    const img = imgs[i];
    cols[`image_${i + 1}`] = img?.url || '';
    cols[`image_${i + 1}_roles`] = (img?.roles || []).join('|');
  }
  return cols;
}

/**
 * Get an option value from a variant's options array.
 */
function getOpt(options, id) {
  const opt = (options || []).find((o) => o.id === id);
  return { value: opt?.value || '', uid: opt?.uid || '' };
}

/**
 * Convert a product JSON into CSV rows (parent + variants).
 */
function productToRows(product) {
  const rows = [];

  // Parent row
  const parent = {
    type: 'parent',
    sku: product.sku,
    parent_sku: '',
    name: product.name,
    path: product.path,
    url: product.url || '',
    description: product.description || '',
    meta_title: product.metaTitle || '',
    meta_description: product.metaDescription || '',
    price_currency: product.price?.currency || '',
    price_regular: product.price?.regular || '',
    price_final: product.price?.final || '',
    availability: product.availability || '',
    ...imageColumns(product.images),
    option_size: '',
    option_color: '',
    option_size_uid: '',
    option_color_uid: '',
    categories: (product.custom?.categories || []).join('|'),
    related: (product.custom?.related || []).join('|'),
  };
  rows.push(parent);

  // Variant rows
  for (const variant of product.variants || []) {
    const size = getOpt(variant.options, 'size');
    const color = getOpt(variant.options, 'color');

    const row = {
      type: 'variant',
      sku: variant.sku,
      parent_sku: product.sku,
      name: variant.name || '',
      path: '',
      url: variant.url || '',
      description: '',
      meta_title: '',
      meta_description: '',
      price_currency: variant.price?.currency || '',
      price_regular: variant.price?.regular || '',
      price_final: variant.price?.final || '',
      availability: variant.availability || '',
      ...imageColumns(variant.images),
      option_size: size.value,
      option_color: color.value,
      option_size_uid: size.uid,
      option_color_uid: color.uid,
      categories: '',
      related: '',
    };
    rows.push(row);
  }

  return rows;
}

// --- Main ---

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const inputDir = path.resolve(__dirname, getArg('--input', '../output/products'));
const outputFile = path.resolve(__dirname, getArg('--output', 'products.csv'));

console.log(`Reading products from: ${inputDir}`);
const files = findJsonFiles(inputDir);
console.log(`Found ${files.length} product files`);

const allRows = [];

for (const file of files) {
  try {
    const product = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const rows = productToRows(product);
    allRows.push(...rows);
  } catch (err) {
    console.error(`Error reading ${file}: ${err.message}`);
  }
}

// Write CSV
const headerLine = COLUMNS.map(csvEscape).join(',');
const dataLines = allRows.map((row) => COLUMNS.map((col) => csvEscape(row[col])).join(','));

fs.writeFileSync(outputFile, [headerLine, ...dataLines].join('\n') + '\n', 'utf-8');

const parentCount = allRows.filter((r) => r.type === 'parent').length;
const variantCount = allRows.filter((r) => r.type === 'variant').length;
console.log(`Wrote ${outputFile}`);
console.log(`  ${parentCount} parents, ${variantCount} variants, ${allRows.length} total rows`);
