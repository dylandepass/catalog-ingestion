/**
 * Extract variant data from a product page.
 *
 * Strategy:
 * 1. Try embedded JSON (Shopify, WooCommerce)
 * 2. Try page interaction (click swatches/dropdowns)
 * 3. Fall back to JSON-LD offers as variants
 *
 * @param {import('playwright').Page} page
 * @param {object} platformConfig
 * @param {object} baseProduct - Already extracted product data
 * @returns {Promise<object[]>} Array of variant objects
 */
export async function extractVariants(page, platformConfig, baseProduct) {
  const method = platformConfig.variantExtraction || 'click';

  // Try JSON extraction first (Shopify, WooCommerce)
  if (method === 'json') {
    const jsonVariants = await extractVariantsFromJson(page, platformConfig);
    if (jsonVariants.length > 0) return jsonVariants;
  }

  // Try click-based extraction
  if (method === 'click' || method === 'json') {
    const clickVariants = await extractVariantsFromClicks(page, platformConfig, baseProduct);
    if (clickVariants.length > 0) return clickVariants;
  }

  // Fall back to any variants already found in JSON-LD
  return baseProduct.variants || [];
}

/**
 * Extract variants from embedded JSON data.
 * Works for Shopify (product JSON) and WooCommerce (data-product_variations).
 */
async function extractVariantsFromJson(page, platformConfig) {
  const variants = [];

  // Try Shopify-style JSON
  if (platformConfig.variantJsonSelector) {
    const selectors = Array.isArray(platformConfig.variantJsonSelector)
      ? platformConfig.variantJsonSelector
      : [platformConfig.variantJsonSelector];

    for (const selector of selectors) {
      try {
        const el = await page.$(selector);
        if (!el) continue;

        let jsonText;
        if (platformConfig.variantJsonAttribute) {
          // WooCommerce stores variants in a data attribute
          jsonText = await el.getAttribute(platformConfig.variantJsonAttribute);
        } else {
          jsonText = await el.textContent();
        }

        if (!jsonText) continue;

        const data = JSON.parse(jsonText);

        // Shopify format: { product: { variants: [...] } } or { variants: [...] }
        const productData = data.product || data;
        const rawVariants = productData.variants || data;

        if (Array.isArray(rawVariants)) {
          for (const v of rawVariants.slice(0, 100)) { // Cap at 100
            const variant = normalizeShopifyVariant(v, productData);
            if (variant) variants.push(variant);
          }
          if (variants.length > 0) return variants;
        }
      } catch { /* ignore parse errors */ }
    }
  }

  return variants;
}

/**
 * Normalize a Shopify variant object.
 */
function normalizeShopifyVariant(v, product) {
  if (!v) return null;

  const variant = {
    sku: v.sku ? String(v.sku) : (v.id ? String(v.id) : ''),
    name: v.title || v.name || '',
    url: v.url || '',
    images: [],
  };

  // Price (Shopify stores in cents)
  if (v.price != null) {
    const price = {};
    const priceVal = typeof v.price === 'number' ? (v.price / 100).toFixed(2) : String(v.price);
    price.final = priceVal;
    if (v.compare_at_price) {
      const compareVal = typeof v.compare_at_price === 'number'
        ? (v.compare_at_price / 100).toFixed(2) : String(v.compare_at_price);
      price.regular = compareVal;
    }
    variant.price = price;
  }

  // Image
  if (v.featured_image?.src) {
    variant.images = [{ url: v.featured_image.src }];
  } else if (v.image_id && product?.images) {
    const img = product.images.find((i) => i.id === v.image_id);
    if (img) variant.images = [{ url: img.src || img.url || '' }];
  }

  // Availability
  if (v.available === false) {
    variant.availability = 'OutOfStock';
  } else if (v.available === true) {
    variant.availability = 'InStock';
  }

  // Options
  if (v.option1 || v.option2 || v.option3) {
    variant.options = [];
    const optionNames = product?.options || [];
    if (v.option1) {
      variant.options.push({
        id: optionNames[0]?.name?.toLowerCase() || 'option1',
        value: v.option1,
      });
    }
    if (v.option2) {
      variant.options.push({
        id: optionNames[1]?.name?.toLowerCase() || 'option2',
        value: v.option2,
      });
    }
    if (v.option3) {
      variant.options.push({
        id: optionNames[2]?.name?.toLowerCase() || 'option3',
        value: v.option3,
      });
    }
  }

  return variant;
}

/**
 * Extract variants by clicking through variant selectors.
 * Used for Magento, BigCommerce, and generic platforms.
 */
async function extractVariantsFromClicks(page, platformConfig, baseProduct) {
  const variantSelectors = platformConfig.variantSelectors;
  if (!variantSelectors) return [];

  const variants = [];

  // Find swatch/option elements
  let optionElements = [];
  const swatchSelectors = variantSelectors.swatches || [];
  const dropdownSelectors = variantSelectors.dropdowns || [];

  // Try swatches first
  for (const sel of swatchSelectors) {
    optionElements = await page.$$(sel);
    if (optionElements.length > 0) break;
  }

  // If no swatches, try dropdowns
  if (optionElements.length === 0) {
    for (const sel of dropdownSelectors) {
      const selectEl = await page.$(sel);
      if (selectEl) {
        // Get all options from the select
        const options = await selectEl.$$('option');
        optionElements = options.filter(async (opt) => {
          const val = await opt.getAttribute('value');
          return val && val !== '';
        });
        break;
      }
    }
  }

  // Cap at 100 to prevent runaway crawls
  const maxOptions = Math.min(optionElements.length, 100);

  for (let i = 0; i < maxOptions; i += 1) {
    try {
      const el = optionElements[i];

      // Get option value/label before clicking
      const optionLabel = await el.textContent().catch(() => '')
        || await el.getAttribute('aria-label').catch(() => '')
        || await el.getAttribute('data-value').catch(() => '');

      // Click the option
      await el.click();

      // Wait for price/content to update
      await page.waitForTimeout(500);

      // Capture current state
      const priceSelector = variantSelectors.priceUpdate?.[0] || '.price';
      const priceText = await page.$eval(priceSelector, (e) => e.textContent?.trim()).catch(() => null);

      const skuText = await page.$eval('[itemprop="sku"], [data-sku], .sku', (e) => e.textContent?.trim())
        .catch(() => null);

      const variant = {
        sku: skuText || `${baseProduct.sku || 'variant'}-${i}`,
        name: `${baseProduct.name || 'Product'} - ${optionLabel?.trim() || `Option ${i + 1}`}`,
        url: page.url(),
        images: baseProduct.images || [],
      };

      if (priceText) {
        const cleaned = priceText.replace(/[^0-9.,]/g, '');
        if (cleaned) {
          variant.price = { final: cleaned };
          if (baseProduct.price?.currency) {
            variant.price.currency = baseProduct.price.currency;
          }
        }
      }

      variants.push(variant);
    } catch { /* ignore click failures */ }
  }

  return variants;
}
