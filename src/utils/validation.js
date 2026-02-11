import { PATH_PATTERN } from './path.js';

const AVAILABILITY_VALUES = [
  'BackOrder', 'Discontinued', 'InStock', 'InStoreOnly', 'LimitedAvailability',
  'MadeToOrder', 'OnlineOnly', 'OutOfStock', 'PreOrder', 'PreSale', 'Reserved', 'SoldOut',
];

const CONDITION_VALUES = [
  'DamagedCondition', 'NewCondition', 'RefurbishedCondition', 'UsedCondition',
];

/**
 * Validate a product against the Product Bus schema.
 * @param {object} product
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProduct(product) {
  const errors = [];

  if (!product || typeof product !== 'object') {
    return { valid: false, errors: ['product must be an object'] };
  }

  // Required fields
  if (!product.sku || typeof product.sku !== 'string') {
    errors.push('sku is required and must be a string');
  }
  if (!product.name || typeof product.name !== 'string') {
    errors.push('name is required and must be a string');
  }
  if (!product.path || typeof product.path !== 'string') {
    errors.push('path is required and must be a string');
  } else {
    if (!PATH_PATTERN.test(product.path)) {
      errors.push(`path "${product.path}" does not match required pattern`);
    }
    if (product.path.length > 900) {
      errors.push('path must be 900 characters or fewer');
    }
  }

  // Optional field types
  if (product.description !== undefined && typeof product.description !== 'string') {
    errors.push('description must be a string');
  }
  if (product.metaTitle !== undefined && typeof product.metaTitle !== 'string') {
    errors.push('metaTitle must be a string');
  }
  if (product.metaDescription !== undefined && typeof product.metaDescription !== 'string') {
    errors.push('metaDescription must be a string');
  }
  if (product.url !== undefined && typeof product.url !== 'string') {
    errors.push('url must be a string');
  }
  if (product.brand !== undefined && typeof product.brand !== 'string') {
    errors.push('brand must be a string');
  }
  if (product.gtin !== undefined && typeof product.gtin !== 'string') {
    errors.push('gtin must be a string');
  }

  // Price validation
  if (product.price !== undefined) {
    if (typeof product.price !== 'object' || product.price === null) {
      errors.push('price must be an object');
    } else {
      for (const key of ['currency', 'regular', 'final']) {
        if (product.price[key] !== undefined && typeof product.price[key] !== 'string') {
          errors.push(`price.${key} must be a string`);
        }
      }
    }
  }

  // Availability
  if (product.availability !== undefined) {
    if (!AVAILABILITY_VALUES.includes(product.availability)) {
      errors.push(`availability must be one of: ${AVAILABILITY_VALUES.join(', ')}`);
    }
  }

  // Item condition
  if (product.itemCondition !== undefined) {
    if (!CONDITION_VALUES.includes(product.itemCondition)) {
      errors.push(`itemCondition must be one of: ${CONDITION_VALUES.join(', ')}`);
    }
  }

  // Images
  if (product.images !== undefined) {
    if (!Array.isArray(product.images)) {
      errors.push('images must be an array');
    } else {
      product.images.forEach((img, i) => {
        if (!img.url || typeof img.url !== 'string') {
          errors.push(`images[${i}].url is required and must be a string`);
        }
      });
    }
  }

  // Variants
  if (product.variants !== undefined) {
    if (!Array.isArray(product.variants)) {
      errors.push('variants must be an array');
    } else {
      product.variants.forEach((v, i) => {
        if (!v.sku || typeof v.sku !== 'string') errors.push(`variants[${i}].sku is required`);
        if (!v.name || typeof v.name !== 'string') errors.push(`variants[${i}].name is required`);
        if (!v.url || typeof v.url !== 'string') errors.push(`variants[${i}].url is required`);
        if (!Array.isArray(v.images)) errors.push(`variants[${i}].images is required and must be an array`);
      });
    }
  }

  // Aggregate rating
  if (product.aggregateRating !== undefined) {
    if (typeof product.aggregateRating !== 'object' || product.aggregateRating === null) {
      errors.push('aggregateRating must be an object');
    } else {
      for (const key of ['ratingValue', 'reviewCount', 'bestRating', 'worstRating']) {
        if (product.aggregateRating[key] !== undefined && typeof product.aggregateRating[key] !== 'string') {
          errors.push(`aggregateRating.${key} must be a string`);
        }
      }
    }
  }

  // Metadata values must be strings
  if (product.metadata !== undefined) {
    if (typeof product.metadata !== 'object' || product.metadata === null) {
      errors.push('metadata must be an object');
    } else {
      for (const [k, v] of Object.entries(product.metadata)) {
        if (typeof v !== 'string') {
          errors.push(`metadata.${k} must be a string`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a batch of products.
 * @param {object[]} products
 * @returns {{ valid: boolean, results: Array<{ index: number, valid: boolean, errors: string[] }> }}
 */
export function validateBatch(products) {
  const results = products.map((p, i) => {
    const { valid, errors } = validateProduct(p);
    return { index: i, valid, errors };
  });
  const allValid = results.every((r) => r.valid);
  return { valid: allValid, results };
}
