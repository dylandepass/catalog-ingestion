export default {
  name: 'generic',

  selectors: {
    productTitle: ['h1[itemprop="name"]', 'h1.product-name', 'h1.product-title', 'h1'],
    price: ['[itemprop="price"]', '[data-price]', '.price', '.product-price', 'span.price', '.current-price', '.sale-price'],
    salePrice: ['.original-price', '.compare-price', '.was-price', '.list-price', 'del .price', '.price-was'],
    currency: ['meta[itemprop="priceCurrency"]', '[data-currency]'],
    description: ['[itemprop="description"]', '.product-description', '.description', '#product-description', '.product-details'],
    images: ['[itemprop="image"]', 'img.product-image', '.product-gallery img', '.product-images img', 'img.primary-image', '.gallery img'],
    sku: ['[itemprop="sku"]', '[data-sku]', '.sku', '.product-sku', '.product-code'],
    brand: ['[itemprop="brand"]', '.brand', '.product-brand', 'meta[property="product:brand"]'],
    availability: ['[itemprop="availability"]', '.stock-status', '.availability', '.in-stock', '.out-of-stock'],
    rating: ['[itemprop="ratingValue"]', '.rating', '.stars', '.review-rating'],
    reviewCount: ['[itemprop="reviewCount"]', '.review-count', '.num-reviews'],
  },

  categorySelectors: {
    productLinks: [
      'a[href*="/product"]', 'a[href*="/products/"]', 'a[href*="/shop/"]',
      'a[href*="/p/"]', '.product a', '.product-card a', '.product-item a',
    ],
    nextPage: ['a[rel="next"]', '.next a', 'a.next', '.pagination .next a', '[aria-label="Next"]'],
  },

  productUrlPatterns: ['/product/', '/products/', '/shop/', '/p/', '/item/'],

  variantExtraction: 'click',
  variantSelectors: {
    swatches: ['.color-swatch', '.variant-option', '.option-swatch', '[data-option]'],
    dropdowns: ['select[name*="option"]', 'select.variant-select', '.product-options select'],
    priceUpdate: ['.price', '[data-price]', '[itemprop="price"]'],
  },

  detection: {
    scripts: [],
    meta: [],
    globals: [],
  },
};
