/**
 * Extract product data from JSON-LD structured data on the page.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<object|null>} Normalized product data or null
 */
export async function extractJsonLd(page) {
  const jsonLdBlocks = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    return Array.from(scripts).map((s) => s.textContent).filter(Boolean);
  });

  for (const block of jsonLdBlocks) {
    let parsed;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }

    const product = findProductInJsonLd(parsed);
    if (product) {
      return normalizeJsonLdProduct(product);
    }
  }

  return null;
}

/**
 * Find a Product object in a JSON-LD structure.
 * Handles single objects, arrays, and @graph patterns.
 */
function findProductInJsonLd(data) {
  if (!data) return null;

  // Direct Product
  if (data['@type'] === 'Product' || data['@type']?.includes?.('Product')) {
    return data;
  }

  // @graph array
  if (data['@graph'] && Array.isArray(data['@graph'])) {
    for (const item of data['@graph']) {
      if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
        return item;
      }
    }
  }

  // Array of objects
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findProductInJsonLd(item);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Normalize a schema.org Product into our intermediate format.
 */
function normalizeJsonLdProduct(product) {
  const result = {};

  // Name
  if (product.name) result.name = String(product.name).trim();

  // SKU
  if (product.sku) result.sku = String(product.sku).trim();

  // Description
  if (product.description) result.description = String(product.description).trim();

  // URL
  if (product.url) result.url = String(product.url).trim();

  // Brand
  if (product.brand) {
    result.brand = typeof product.brand === 'object'
      ? product.brand.name
      : String(product.brand);
  }

  // GTIN
  const gtin = product.gtin || product.gtin13 || product.gtin12 || product.gtin8 || product.gtin14;
  if (gtin) result.gtin = String(gtin);

  // Images
  result.images = normalizeImages(product.image);

  // Aggregate rating
  if (product.aggregateRating) {
    result.aggregateRating = {};
    const r = product.aggregateRating;
    if (r.ratingValue != null) result.aggregateRating.ratingValue = String(r.ratingValue);
    if (r.reviewCount != null) result.aggregateRating.reviewCount = String(r.reviewCount);
    if (r.ratingCount != null && !r.reviewCount) result.aggregateRating.reviewCount = String(r.ratingCount);
    if (r.bestRating != null) result.aggregateRating.bestRating = String(r.bestRating);
    if (r.worstRating != null) result.aggregateRating.worstRating = String(r.worstRating);
  }

  // Offers → price + variants
  if (product.offers) {
    const offers = normalizeOffers(product.offers);
    if (offers.length === 1) {
      // Single offer = main product price
      const offer = offers[0];
      result.price = offer.price;
      result.availability = offer.availability;
      result.itemCondition = offer.itemCondition;
      if (offer.sku && offer.sku !== result.sku) {
        // SKU from offer if not on product
        result.sku = result.sku || offer.sku;
      }
    } else if (offers.length > 1) {
      // Multiple offers = variants
      // Use first offer for main price
      result.price = offers[0].price;
      result.availability = offers[0].availability;
      result.itemCondition = offers[0].itemCondition;
      result.variants = offers.map((offer) => ({
        sku: offer.sku || '',
        name: offer.name || result.name || '',
        url: offer.url || '',
        images: offer.images?.length ? offer.images : result.images || [],
        price: offer.price,
        availability: offer.availability,
      }));
    }
  }

  // hasVariant → variants (schema.org ProductModel pattern)
  // Some sites use hasVariant instead of (or alongside) multiple offers.
  // Each entry is a ProductModel with its own name, sku, url, image, offers, etc.
  if (product.hasVariant) {
    const rawVariants = Array.isArray(product.hasVariant)
      ? product.hasVariant : [product.hasVariant];

    const hasVariantResults = rawVariants.map((v) => normalizeHasVariant(v, result));

    if (hasVariantResults.length > 0) {
      // If we didn't already get price from offers, take it from the first variant
      if (!result.price && hasVariantResults[0].price) {
        result.price = hasVariantResults[0].price;
      }
      if (!result.availability && hasVariantResults[0].availability) {
        result.availability = hasVariantResults[0].availability;
      }

      // Merge with any variants already found via offers
      if (result.variants) {
        // Deduplicate by SKU — hasVariant entries take priority as they're more detailed
        const existingSkus = new Set(result.variants.map((v) => v.sku));
        for (const hv of hasVariantResults) {
          if (!existingSkus.has(hv.sku)) {
            result.variants.push(hv);
          }
        }
      } else {
        result.variants = hasVariantResults;
      }
    }
  }

  return result;
}

/**
 * Normalize image field (string, array of strings, array of ImageObjects).
 */
function normalizeImages(imageData) {
  if (!imageData) return [];

  const images = Array.isArray(imageData) ? imageData : [imageData];
  return images
    .map((img) => {
      if (typeof img === 'string') return { url: img };
      if (typeof img === 'object' && img.url) {
        return {
          url: img.url,
          ...(img.name ? { label: img.name } : {}),
          ...(img.caption ? { label: img.caption } : {}),
        };
      }
      if (typeof img === 'object' && img['@id']) return { url: img['@id'] };
      return null;
    })
    .filter(Boolean);
}

/**
 * Normalize offers (Offer, AggregateOffer, or array).
 */
function normalizeOffers(offersData) {
  if (!offersData) return [];

  // AggregateOffer with child offers
  if (offersData['@type'] === 'AggregateOffer' && offersData.offers) {
    const children = Array.isArray(offersData.offers) ? offersData.offers : [offersData.offers];
    return children.map(normalizeOffer);
  }

  // Single offer
  if (offersData['@type'] === 'Offer') {
    return [normalizeOffer(offersData)];
  }

  // Array of offers
  if (Array.isArray(offersData)) {
    return offersData.map(normalizeOffer);
  }

  // Object without @type (treat as single offer)
  if (offersData.price != null || offersData.priceCurrency) {
    return [normalizeOffer(offersData)];
  }

  return [];
}

/**
 * Normalize a single Offer object.
 */
function normalizeOffer(offer) {
  const result = {};

  if (offer.sku) result.sku = String(offer.sku);
  if (offer.name) result.name = String(offer.name);
  if (offer.url) result.url = String(offer.url);

  // Price
  const price = {};
  if (offer.priceCurrency) price.currency = String(offer.priceCurrency);
  if (offer.price != null) price.final = String(offer.price);

  // Look for regular price in priceSpecification
  if (offer.priceSpecification) {
    const specs = Array.isArray(offer.priceSpecification)
      ? offer.priceSpecification : [offer.priceSpecification];
    for (const spec of specs) {
      if (spec.priceType === 'ListPrice' || spec.priceType === 'MSRP') {
        price.regular = String(spec.price);
      }
      if (!price.currency && spec.priceCurrency) {
        price.currency = String(spec.priceCurrency);
      }
    }
  }

  if (Object.keys(price).length) result.price = price;

  // Availability — strip schema.org URL prefix
  if (offer.availability) {
    result.availability = stripSchemaOrg(offer.availability);
  }

  // Item condition
  if (offer.itemCondition) {
    result.itemCondition = stripSchemaOrg(offer.itemCondition);
  }

  // Images from offer
  if (offer.image) {
    result.images = normalizeImages(offer.image);
  }

  return result;
}

/**
 * Normalize a hasVariant entry (schema.org ProductModel or Product).
 *
 * hasVariant items are full product-like objects with their own
 * name, sku, url, image, offers, description, additionalProperty, etc.
 *
 * @param {object} variant - The hasVariant entry
 * @param {object} parentResult - The parent product's normalized result (for fallbacks)
 */
function normalizeHasVariant(variant, parentResult) {
  const result = {
    sku: '',
    name: '',
    url: '',
    images: [],
  };

  // SKU
  if (variant.sku) result.sku = String(variant.sku).trim();
  else if (variant.productID) result.sku = String(variant.productID).trim();
  else if (variant.identifier) result.sku = String(variant.identifier).trim();

  // Name
  if (variant.name) result.name = String(variant.name).trim();

  // URL
  if (variant.url) result.url = String(variant.url).trim();

  // Description
  if (variant.description) result.description = String(variant.description).trim();

  // Images — from the variant's own image field
  const variantImages = normalizeImages(variant.image);
  result.images = variantImages.length > 0 ? variantImages : (parentResult.images || []);

  // GTIN
  const gtin = variant.gtin || variant.gtin13 || variant.gtin12 || variant.gtin8 || variant.gtin14;
  if (gtin) result.gtin = String(gtin);

  // Offers on the variant → price + availability
  if (variant.offers) {
    const offers = normalizeOffers(variant.offers);
    if (offers.length > 0) {
      const offer = offers[0];
      if (offer.price) result.price = offer.price;
      if (offer.availability) result.availability = offer.availability;
      if (offer.itemCondition) result.itemCondition = offer.itemCondition;
      // Offer may have a more specific URL
      if (offer.url && !result.url) result.url = offer.url;
    }
  }

  // Direct price fields on the variant itself (some sites put these directly)
  if (!result.price) {
    if (variant.price != null || variant.priceCurrency) {
      const price = {};
      if (variant.priceCurrency) price.currency = String(variant.priceCurrency);
      if (variant.price != null) price.final = String(variant.price);
      result.price = price;
    }
  }

  // Direct availability on the variant
  if (!result.availability && variant.availability) {
    result.availability = stripSchemaOrg(variant.availability);
  }

  // Options from additionalProperty (common pattern for variant attributes)
  if (variant.additionalProperty) {
    const props = Array.isArray(variant.additionalProperty)
      ? variant.additionalProperty : [variant.additionalProperty];

    result.options = props
      .filter((p) => p.name && p.value != null)
      .map((p) => ({
        id: String(p.name).toLowerCase().replace(/\s+/g, '-'),
        value: String(p.value),
      }));

    if (result.options.length === 0) delete result.options;
  }

  // Also check for color/size/material as direct properties (some sites use these)
  if (!result.options) {
    const directOptions = [];
    for (const prop of ['color', 'size', 'material', 'pattern', 'width', 'height']) {
      if (variant[prop]) {
        directOptions.push({ id: prop, value: String(variant[prop]) });
      }
    }
    if (directOptions.length > 0) result.options = directOptions;
  }

  return result;
}

/**
 * Strip "https://schema.org/" prefix from enum values.
 */
function stripSchemaOrg(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace('https://schema.org/', '')
    .replace('http://schema.org/', '');
}
