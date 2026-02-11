import shopify from './shopify.js';
import magento from './magento.js';
import bigcommerce from './bigcommerce.js';
import woocommerce from './woocommerce.js';
import generic from './generic.js';

const PLATFORMS = { shopify, magento, bigcommerce, woocommerce, generic };

/**
 * Auto-detect the e-commerce platform from page content.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ platform: string, confidence: string, config: object }>}
 */
export async function detectPlatform(page) {
  const results = await page.evaluate(() => {
    const checks = {};

    // Check global variables
    checks.hasShopify = typeof window.Shopify !== 'undefined';
    checks.hasBCData = typeof window.BCData !== 'undefined';
    checks.hasMage = typeof window.Mage !== 'undefined' || typeof window.require?.s?.contexts?._ !== 'undefined';
    checks.hasWooCommerce = typeof window.wc_add_to_cart_params !== 'undefined'
      || typeof window.wc_cart_params !== 'undefined';

    // Check page source
    const html = document.documentElement.outerHTML;
    checks.hasShopifyCdn = html.includes('cdn.shopify.com');
    checks.hasMagentoStatic = html.includes('/static/version');
    checks.hasFormKey = !!document.querySelector('input[name="form_key"]');
    checks.hasStencil = !!document.querySelector('[data-stencil]');
    checks.hasWooClass = document.body?.classList?.contains('woocommerce') || false;
    checks.hasWcScripts = html.includes('wc-add-to-cart') || html.includes('woocommerce');

    return checks;
  });

  // Shopify
  if (results.hasShopify || results.hasShopifyCdn) {
    return {
      platform: 'shopify',
      confidence: results.hasShopify ? 'high' : 'medium',
      config: PLATFORMS.shopify,
    };
  }

  // Magento
  if (results.hasMage || (results.hasMagentoStatic && results.hasFormKey)) {
    return {
      platform: 'magento',
      confidence: results.hasMage ? 'high' : 'medium',
      config: PLATFORMS.magento,
    };
  }

  // BigCommerce
  if (results.hasBCData || results.hasStencil) {
    return {
      platform: 'bigcommerce',
      confidence: results.hasBCData ? 'high' : 'medium',
      config: PLATFORMS.bigcommerce,
    };
  }

  // WooCommerce
  if (results.hasWooCommerce || (results.hasWooClass && results.hasWcScripts)) {
    return {
      platform: 'woocommerce',
      confidence: results.hasWooCommerce ? 'high' : 'medium',
      config: PLATFORMS.woocommerce,
    };
  }

  return {
    platform: 'generic',
    confidence: 'low',
    config: PLATFORMS.generic,
  };
}

/**
 * Get platform config by name.
 * @param {string} name
 * @returns {object}
 */
export function getPlatformConfig(name) {
  return PLATFORMS[name] || PLATFORMS.generic;
}
