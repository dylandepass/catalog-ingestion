export default {
  name: 'shopify',

  selectors: {
    productTitle: ['h1.product-single__title', 'h1.product__title', '.product-title h1', '.product__title', 'h1[itemprop="name"]', 'h1'],
    price: ['.product__price', '.price__regular .money', '.price-item--regular', '[data-product-price]', '.money', '.price .amount'],
    salePrice: ['.price__sale .money', '.price--sale', '.price-item--sale', '[data-compare-price]', '.compare-price'],
    currency: ['meta[itemprop="priceCurrency"]'],
    description: ['.product-single__description', '.product__description', '.product-description', '[data-product-description]', '.rte'],
    images: ['.product__media img', '.product-single__media img', '.product-featured-image', '.product__photo img', 'img.photoswipe__image'],
    sku: ['[data-sku]', '.product-sku', '.product-single__sku'],
    brand: ['[data-vendor]', '.product__vendor', '.product-single__vendor', 'meta[itemprop="brand"]'],
    availability: ['[data-availability]', '.product-form__inventory', '.product__inventory'],
    rating: ['.spr-badge-caption', '.yotpo-stars', '.stamped-badge', '.jdgm-prev-badge'],
    reviewCount: ['.spr-badge-caption', '.yotpo-reviews-count', '.stamped-badge-caption'],
  },

  categorySelectors: {
    productLinks: ['a[href*="/products/"]'],
    nextPage: ['a.pagination__next', '.pagination a[rel="next"]'],
  },

  productUrlPatterns: ['/products/'],

  variantExtraction: 'json',
  variantJsonSelector: [
    'script[type="application/json"][data-product-json]',
    'script#ProductJson-product-template',
    'script#product-json',
    'script[id*="ProductJson"]',
  ],

  detection: {
    scripts: ['cdn.shopify.com', 'Shopify.shop', 'shopify-buy'],
    meta: ['shopify-checkout-api-token', 'shopify-digital-wallet'],
    globals: ['Shopify'],
  },
};
