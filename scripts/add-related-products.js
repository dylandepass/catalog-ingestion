#!/usr/bin/env node

/**
 * Adds related products to each product JSON file in the output directory.
 * Categorizes products by type (tees, hoodies, hats, etc.) and relates
 * products within the same category. Falls back to random picks if
 * a category is too small.
 */

import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = path.resolve(import.meta.dirname, '..', 'output', 'products');
const RELATED_COUNT = 5;

// ─── Load all products ───────────────────────────────────────────

function loadProducts() {
  const products = [];
  for (const dir of fs.readdirSync(OUTPUT_DIR)) {
    const dirPath = path.join(OUTPUT_DIR, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    if (files.length === 0) continue;
    const filePath = path.join(dirPath, files[0]);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    products.push({ data, filePath });
  }
  return products;
}

// ─── Category rules ──────────────────────────────────────────────

const CATEGORY_RULES = [
  { category: 'tees', test: (n) => /\btee\b|t-shirt/i.test(n) },
  { category: 'hoodies-sweaters', test: (n) => /hoodie|crewneck|pullover|sweater|zip-up|sherpa jacket|windbreaker/i.test(n) },
  { category: 'polos-buttonups', test: (n) => /polo|button-up/i.test(n) },
  { category: 'vests', test: (n) => /vest\b/i.test(n) },
  { category: 'hats', test: (n) => /\bhat\b|bucket hat/i.test(n) },
  { category: 'socks', test: (n) => /socks/i.test(n) },
  { category: 'bags-totes', test: (n) => /backpack|tote|folio|bag strap|belt bag|pouch|luggage/i.test(n) },
  { category: 'drinkware', test: (n) => /tumbler|mug|bottle|carafe|glass|wine chiller/i.test(n) },
  { category: 'stickers', test: (n) => /sticker/i.test(n) },
  { category: 'pins', test: (n) => /\bpin\b|lapel pin/i.test(n) },
  { category: 'patches', test: (n) => /patch\b/i.test(n) },
  { category: 'journals-notecards', test: (n) => /journal|notecard/i.test(n) },
  { category: 'pens', test: (n) => /\bpen\b|pens\b|stylus/i.test(n) },
  { category: 'tech', test: (n) => /earbuds|headphones|speaker|camera|charger|adapter|USB|webcam|powerbank/i.test(n) },
  { category: 'home-kitchen', test: (n) => /blanket|pillow|candle|apron|planter|tray|magnet|desk pad|lap desk|umbrella/i.test(n) },
  { category: 'kids-baby', test: (n) => /toddler|youth|onesie|bib|llama plush|unicorn plush/i.test(n) },
  { category: 'gift-sets', test: (n) => /gift set|gift card|coloring kit/i.test(n) },
  { category: 'accessories', test: (n) => /keychain|keytag|lanyard|sunglasses|shoe charm|playing card|pickleball|frisbee|towel|skin|door hanger|print\b/i.test(n) },
];

function categorize(name) {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(name)) return rule.category;
  }
  return 'other';
}

// ─── Main ────────────────────────────────────────────────────────

const products = loadProducts();
console.log(`Loaded ${products.length} products`);

// Build category map
const categoryMap = new Map();
for (const p of products) {
  const cat = categorize(p.data.name);
  p.category = cat;
  if (!categoryMap.has(cat)) categoryMap.set(cat, []);
  categoryMap.get(cat).push(p);
}

// Print categories
console.log('\nCategories:');
for (const [cat, items] of [...categoryMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${cat}: ${items.length} products`);
}

// Assign related products
let updated = 0;
for (const p of products) {
  const sameCat = categoryMap.get(p.category).filter((o) => o.data.path !== p.data.path);

  let related;
  if (sameCat.length >= RELATED_COUNT) {
    // Pick 5 random from same category
    related = pickRandom(sameCat, RELATED_COUNT);
  } else {
    // Use all from same category, fill remainder from other products
    related = [...sameCat];
    const others = products.filter(
      (o) => o.data.path !== p.data.path && !related.includes(o),
    );
    const needed = RELATED_COUNT - related.length;
    related.push(...pickRandom(others, needed));
  }

  const relatedPaths = related.map((r) => r.data.path);

  // Add custom.related to product data
  if (!p.data.custom) p.data.custom = {};
  p.data.custom.related = relatedPaths;

  // Write back
  fs.writeFileSync(p.filePath, JSON.stringify(p.data, null, 2) + '\n');
  updated++;
}

console.log(`\nUpdated ${updated} product files with related products`);

// ─── Helpers ─────────────────────────────────────────────────────

function pickRandom(arr, count) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
