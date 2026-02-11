import { urlToProductBusPath, sanitizeSku, skuFromUrl } from '../utils/path.js';
import { validateProduct } from '../utils/validation.js';

/**
 * Map of availability text → Product Bus enum value.
 */
const AVAILABILITY_MAP = {
  instock: 'InStock',
  'in stock': 'InStock',
  'in_stock': 'InStock',
  outofstock: 'OutOfStock',
  'out of stock': 'OutOfStock',
  'out_of_stock': 'OutOfStock',
  preorder: 'PreOrder',
  'pre-order': 'PreOrder',
  pre_order: 'PreOrder',
  presale: 'PreSale',
  'pre-sale': 'PreSale',
  backorder: 'BackOrder',
  'back order': 'BackOrder',
  discontinued: 'Discontinued',
  soldout: 'SoldOut',
  'sold out': 'SoldOut',
  sold_out: 'SoldOut',
  limitedavailability: 'LimitedAvailability',
  'limited availability': 'LimitedAvailability',
  madetoorder: 'MadeToOrder',
  'made to order': 'MadeToOrder',
  onlineonly: 'OnlineOnly',
  'online only': 'OnlineOnly',
  instoreonly: 'InStoreOnly',
  'in store only': 'InStoreOnly',
  reserved: 'Reserved',
};

const CONDITION_MAP = {
  newcondition: 'NewCondition',
  new: 'NewCondition',
  refurbishedcondition: 'RefurbishedCondition',
  refurbished: 'RefurbishedCondition',
  usedcondition: 'UsedCondition',
  used: 'UsedCondition',
  damagedcondition: 'DamagedCondition',
  damaged: 'DamagedCondition',
};

/**
 * Transform raw extracted product data into Product Bus schema.
 *
 * @param {object} rawData - Data from the extractor
 * @param {string} sourceUrl - The source URL
 * @param {{ pathPrefix?: string, defaultCurrency?: string }} [options]
 * @returns {{ product: object|null, warnings: string[], errors: string[] }}
 */
export function transformProduct(rawData, sourceUrl, options = {}) {
  const { pathPrefix, defaultCurrency = 'USD' } = options;
  const warnings = [];
  const errors = [];

  if (!rawData) {
    return { product: null, warnings, errors: ['No data to transform'] };
  }

  // Generate path from source URL
  const path = urlToProductBusPath(sourceUrl, { prefix: pathPrefix });
  if (!path) {
    errors.push(`Could not generate valid path from URL: ${sourceUrl}`);
    return { product: null, warnings, errors };
  }

  // Build the Product Bus entry
  const product = { path };

  // SKU (required)
  product.sku = sanitizeSku(rawData.sku) || skuFromUrl(sourceUrl);
  if (!product.sku) {
    warnings.push('No SKU found, derived from URL');
    product.sku = skuFromUrl(sourceUrl);
  }

  // Name (required)
  product.name = rawData.name?.trim();
  if (!product.name) {
    errors.push('No product name found');
    return { product: null, warnings, errors };
  }

  // URL
  product.url = rawData.url || sourceUrl;

  // Description
  if (rawData.description) {
    product.description = rawData.description;
  }

  // SEO fields
  if (rawData.metaTitle) product.metaTitle = rawData.metaTitle;
  if (rawData.metaDescription) product.metaDescription = rawData.metaDescription;

  // Brand
  if (rawData.brand) product.brand = String(rawData.brand).trim();

  // GTIN
  if (rawData.gtin) product.gtin = String(rawData.gtin);

  // Price
  if (rawData.price) {
    product.price = {};
    if (rawData.price.currency) {
      product.price.currency = String(rawData.price.currency).toUpperCase();
    } else {
      product.price.currency = defaultCurrency;
      warnings.push(`No currency found, defaulting to ${defaultCurrency}`);
    }
    if (rawData.price.regular != null) product.price.regular = String(rawData.price.regular);
    if (rawData.price.final != null) product.price.final = String(rawData.price.final);
  }

  // Availability
  if (rawData.availability) {
    product.availability = normalizeAvailability(rawData.availability);
    if (!product.availability) {
      warnings.push(`Unknown availability value: "${rawData.availability}"`);
    }
  }

  // Item condition
  if (rawData.itemCondition) {
    product.itemCondition = normalizeCondition(rawData.itemCondition);
  }

  // Images
  if (rawData.images?.length > 0) {
    product.images = rawData.images
      .filter((img) => img.url && typeof img.url === 'string')
      .filter((img) => img.url.startsWith('http'))
      .map((img) => {
        const entry = { url: img.url };
        if (img.label) entry.label = img.label;
        if (img.roles) entry.roles = img.roles;
        return entry;
      });
    if (product.images.length === 0) delete product.images;
  }

  // Aggregate rating
  if (rawData.aggregateRating) {
    const rating = {};
    const r = rawData.aggregateRating;
    if (r.ratingValue != null) rating.ratingValue = String(r.ratingValue);
    if (r.reviewCount != null) rating.reviewCount = String(r.reviewCount);
    if (r.bestRating != null) rating.bestRating = String(r.bestRating);
    if (r.worstRating != null) rating.worstRating = String(r.worstRating);
    if (Object.keys(rating).length > 0) product.aggregateRating = rating;
  }

  // Variants
  if (rawData.variants?.length > 0) {
    product.variants = rawData.variants
      .map((v) => transformVariant(v, product, sourceUrl))
      .filter(Boolean);

    if (product.variants.length === 0) {
      delete product.variants;
    } else {
      // Build top-level options by aggregating across all variant options
      product.options = buildTopLevelOptions(product.variants);
      if (product.options.length === 0) delete product.options;
    }
  }

  // Clean up undefined/null values
  for (const key of Object.keys(product)) {
    if (product[key] === undefined || product[key] === null) {
      delete product[key];
    }
  }

  // Validate
  const validation = validateProduct(product);
  if (!validation.valid) {
    return { product: null, warnings, errors: validation.errors };
  }

  return { product, warnings, errors };
}

/**
 * Transform a variant into Product Bus variant schema.
 */
function transformVariant(v, parentProduct, sourceUrl) {
  if (!v) return null;

  const variant = {
    sku: sanitizeSku(v.sku) || `${parentProduct.sku}-${Math.random().toString(36).slice(2, 7)}`,
    name: v.name || parentProduct.name,
    url: v.url || sourceUrl,
    images: [],
  };

  // Images
  if (v.images?.length > 0) {
    variant.images = v.images
      .filter((img) => img.url && typeof img.url === 'string')
      .map((img) => {
        const entry = { url: img.url };
        if (img.label) entry.label = img.label;
        return entry;
      });
  }

  // Fall back to parent images if variant has none
  if (variant.images.length === 0 && parentProduct.images?.length > 0) {
    variant.images = [parentProduct.images[0]];
  }

  // If still no images, add a placeholder to satisfy schema requirement
  if (variant.images.length === 0) {
    return null; // Can't create a valid variant without images
  }

  // Price
  if (v.price) {
    variant.price = {};
    if (v.price.currency) variant.price.currency = String(v.price.currency).toUpperCase();
    else if (parentProduct.price?.currency) variant.price.currency = parentProduct.price.currency;
    if (v.price.regular != null) variant.price.regular = String(v.price.regular);
    if (v.price.final != null) variant.price.final = String(v.price.final);
  }

  // Availability
  if (v.availability) {
    variant.availability = normalizeAvailability(v.availability);
  }

  // Options
  if (v.options?.length > 0) {
    variant.options = v.options.map((opt) => ({
      ...(opt.id ? { id: opt.id } : {}),
      value: String(opt.value),
      ...(opt.uid ? { uid: opt.uid } : {}),
    }));
  }

  return variant;
}

/**
 * Build top-level options array from variant options.
 *
 * Scans all variants' `options` arrays to collect every unique option id
 * and all the distinct values seen for that option, preserving encounter order.
 *
 * Example output:
 * [
 *   { id: "color", label: "Color", position: 1, values: [{ value: "Red" }, { value: "Blue" }] },
 *   { id: "size",  label: "Size",  position: 2, values: [{ value: "S" }, { value: "M" }, { value: "L" }] },
 * ]
 *
 * @param {object[]} variants - Transformed variants with per-variant `options`
 * @returns {object[]}
 */
function buildTopLevelOptions(variants) {
  // Map of option id → { label, values: Map<value, uid> }
  const optionMap = new Map();

  for (const variant of variants) {
    if (!variant.options?.length) continue;

    for (const opt of variant.options) {
      if (!opt.value) continue;

      const id = opt.id || opt.value.toLowerCase().replace(/\s+/g, '-');

      if (!optionMap.has(id)) {
        // Derive a human-readable label: capitalize first letter of each word
        const label = (opt.id || opt.value)
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        optionMap.set(id, { label, values: new Map() });
      }

      const entry = optionMap.get(id);
      if (!entry.values.has(opt.value)) {
        entry.values.set(opt.value, opt.uid || undefined);
      }
    }
  }

  let position = 0;
  const options = [];
  for (const [id, { label, values }] of optionMap) {
    position += 1;
    const option = {
      id,
      label,
      position,
      values: [],
    };
    for (const [value, uid] of values) {
      const entry = { value };
      if (uid) entry.uid = uid;
      option.values.push(entry);
    }
    options.push(option);
  }

  return options;
}

/**
 * Normalize availability text to Product Bus enum.
 */
function normalizeAvailability(value) {
  if (!value) return undefined;
  const stripped = String(value)
    .replace('https://schema.org/', '')
    .replace('http://schema.org/', '');
  const key = stripped.toLowerCase().trim();
  return AVAILABILITY_MAP[key] || undefined;
}

/**
 * Normalize item condition to Product Bus enum.
 */
function normalizeCondition(value) {
  if (!value) return undefined;
  const stripped = String(value)
    .replace('https://schema.org/', '')
    .replace('http://schema.org/', '');
  const key = stripped.toLowerCase().trim();
  return CONDITION_MAP[key] || undefined;
}
