/**
 * Normalize Adobe Commerce Catalog Service GraphQL responses
 * into the same intermediate format that the existing transformer expects.
 *
 * This produces the same shape as the JSON-LD/HTML extractors:
 *   { name, sku, description, url, images, price, availability, variants, ... }
 */

/**
 * Normalize a product from the Catalog Service products query,
 * optionally merging variant data from the variants query.
 *
 * @param {object} productView - Product from the products() query
 * @param {object[]} [variantsData] - Variants from the variants() query (for ComplexProductView)
 * @param {string} [baseUrl] - Base URL for building product URLs
 * @returns {object} Intermediate product format for the transformer
 */
export function normalizeProduct(productView, variantsData, baseUrl) {
  const result = {};

  // Basic fields
  result.name = productView.name?.trim();
  result.sku = productView.sku?.trim();

  if (productView.description) {
    // Strip HTML tags for a clean text description
    result.description = stripHtml(productView.description);
  }

  // URL
  if (productView.url) {
    result.url = productView.url;
  } else if (productView.urlKey && baseUrl) {
    result.url = `${baseUrl.replace(/\/$/, '')}/products/${productView.urlKey}/${productView.sku?.toLowerCase()}`;
  }

  // SEO fields
  if (productView.metaTitle) result.metaTitle = productView.metaTitle;
  if (productView.metaDescription) result.metaDescription = productView.metaDescription;

  // Images
  if (productView.images?.length > 0) {
    result.images = productView.images
      .filter((img) => img.url)
      .map((img) => {
        const entry = { url: normalizeImageUrl(img.url) };
        if (img.label) entry.label = img.label;
        if (img.roles?.length > 0) entry.roles = img.roles;
        return entry;
      });
  }

  // Availability
  if (productView.inStock === true) {
    result.availability = 'InStock';
  } else if (productView.inStock === false) {
    result.availability = 'OutOfStock';
  }

  // Attributes → brand, custom fields
  if (productView.attributes?.length > 0) {
    for (const attr of productView.attributes) {
      if (attr.name === 'brand' && attr.value) result.brand = attr.value;
    }
  }

  // Price handling differs by product type
  const isComplex = productView.__typename === 'ComplexProductView';

  if (isComplex) {
    // ComplexProductView: price from priceRange
    result.price = extractPriceRange(productView.priceRange);

    // Options + variants
    if (productView.options?.length > 0 && variantsData?.length > 0) {
      const { variants, options } = buildVariantsWithOptions(
        productView,
        variantsData,
        result.images,
      );
      if (variants.length > 0) result.variants = variants;
      // Options are passed through so the transformer's buildTopLevelOptions can still work,
      // but we also embed them on each variant for the UID mapping
      if (options) result._catalogServiceOptions = options;
    }
  } else {
    // SimpleProductView: direct price
    result.price = extractPrice(productView.price);
  }

  return result;
}

/**
 * Build variant objects with options mapped from selections UIDs.
 *
 * @param {object} productView - The product with options
 * @param {object[]} variantsData - Array of { selections, product } from variants query
 * @param {object[]} [parentImages] - Parent product images for fallback
 * @returns {{ variants: object[], options: object[] }}
 */
function buildVariantsWithOptions(productView, variantsData, parentImages) {
  // Build UID → { optionId, optionTitle, valueTitle } lookup
  const uidMap = new Map();
  for (const option of productView.options || []) {
    for (const value of option.values || []) {
      if (value.id) {
        uidMap.set(value.id, {
          optionId: option.id,
          optionTitle: option.title,
          valueTitle: value.title,
        });
      }
    }
  }

  const variants = [];
  for (const v of variantsData) {
    if (!v.product) continue;

    const variant = {
      sku: v.product.sku || '',
      name: v.product.name || '',
      url: '',
      images: [],
    };

    // Images — fall back to parent
    if (v.product.images?.length > 0) {
      variant.images = v.product.images
        .filter((img) => img.url)
        .map((img) => {
          const entry = { url: normalizeImageUrl(img.url) };
          if (img.label) entry.label = img.label;
          return entry;
        });
    }
    if (variant.images.length === 0 && parentImages?.length > 0) {
      variant.images = [parentImages[0]];
    }

    // Price
    variant.price = extractPrice(v.product.price);

    // Availability
    if (v.product.inStock === true) {
      variant.availability = 'InStock';
    } else if (v.product.inStock === false) {
      variant.availability = 'OutOfStock';
    }

    // Map selections UIDs to option values
    if (v.selections?.length > 0) {
      const options = [];
      for (const uid of v.selections) {
        const match = uidMap.get(uid);
        if (match) {
          // Avoid duplicate option IDs
          if (!options.some((o) => o.id === match.optionId)) {
            options.push({
              id: match.optionId,
              value: match.valueTitle,
              uid,
            });
          }
        }
      }
      if (options.length > 0) {
        variant.options = options;
      }
    }

    variants.push(variant);
  }

  // Also return the top-level options structure from the product
  const options = (productView.options || []).map((opt) => ({
    id: opt.id,
    title: opt.title,
    values: (opt.values || []).map((v) => ({
      id: v.id,
      title: v.title,
      inStock: v.inStock,
    })),
  }));

  return { variants, options };
}

/**
 * Extract price from a SimpleProductView price object.
 */
function extractPrice(priceObj) {
  if (!priceObj) return undefined;

  const price = {};

  if (priceObj.final?.amount) {
    price.final = String(priceObj.final.amount.value);
    price.currency = priceObj.final.amount.currency;
  }

  if (priceObj.regular?.amount) {
    price.regular = String(priceObj.regular.amount.value);
    if (!price.currency) price.currency = priceObj.regular.amount.currency;
  }

  return Object.keys(price).length > 0 ? price : undefined;
}

/**
 * Extract price from a ComplexProductView priceRange object.
 * Uses the minimum final price as the main product price.
 */
function extractPriceRange(priceRange) {
  if (!priceRange) return undefined;

  const price = {};

  // Use minimum price as the product's display price
  const min = priceRange.minimum;
  if (min?.final?.amount) {
    price.final = String(min.final.amount.value);
    price.currency = min.final.amount.currency;
  }
  if (min?.regular?.amount) {
    price.regular = String(min.regular.amount.value);
    if (!price.currency) price.currency = min.regular.amount.currency;
  }

  return Object.keys(price).length > 0 ? price : undefined;
}

/**
 * Normalize image URLs — ensure protocol is present.
 */
function normalizeImageUrl(url) {
  if (!url) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html) {
  if (!html) return html;
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
