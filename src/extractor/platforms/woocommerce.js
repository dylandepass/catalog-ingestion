export default {
  name: 'woocommerce',

  selectors: {
    productTitle: ['.product_title', 'h1.entry-title', '.woocommerce-loop-product__title', 'h1[itemprop="name"]', 'h1'],
    price: ['.woocommerce-Price-amount', '.price ins .woocommerce-Price-amount', '.summary .price .amount', 'p.price .woocommerce-Price-amount'],
    salePrice: ['.price del .woocommerce-Price-amount', '.summary .price del .amount'],
    currency: ['meta[itemprop="priceCurrency"]', '.woocommerce-Price-currencySymbol'],
    description: ['.woocommerce-product-details__short-description', '.product-description', '#tab-description .woocommerce-Tabs-panel--description', '.entry-content'],
    images: ['.woocommerce-product-gallery__image img', '.wp-post-image', 'img.attachment-woocommerce_single', '.product-image img'],
    sku: ['.sku', '.product_meta .sku', '[itemprop="sku"]'],
    brand: ['.product_meta .posted_in a', '[itemprop="brand"]', '.product-brand'],
    availability: ['.stock', '.in-stock', '.out-of-stock', '[itemprop="availability"]'],
    rating: ['.star-rating span', '.woocommerce-product-rating .star-rating'],
    reviewCount: ['.woocommerce-review-link', '.review-count'],
  },

  categorySelectors: {
    productLinks: ['.woocommerce-LoopProduct-link', 'a.wc-block-grid__product', 'li.product a[href*="/product/"]'],
    nextPage: ['a.next.page-numbers', 'a[rel="next"]'],
  },

  productUrlPatterns: ['/product/'],

  variantExtraction: 'json',
  variantJsonSelector: [
    'form.variations_form',
  ],
  variantJsonAttribute: 'data-product_variations',

  detection: {
    scripts: ['woocommerce', 'wc-add-to-cart', 'wc-cart-fragments'],
    meta: ['woocommerce'],
    globals: ['wc_add_to_cart_params', 'wc_cart_params'],
    bodyClasses: ['woocommerce', 'is-type-product'],
  },
};
