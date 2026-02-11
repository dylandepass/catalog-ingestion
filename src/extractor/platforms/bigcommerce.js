export default {
  name: 'bigcommerce',

  selectors: {
    productTitle: ['h1.productView-title', '.productView-title', 'h1[data-product-title]', 'h1'],
    price: ['.productView-price .price--withoutTax', '.productView-price .price-section .price', '.price--main .price--withoutTax', '[data-product-price-without-tax]'],
    salePrice: ['.price--rrp', '.productView-price .price--non-sale', '.price--rrp .price'],
    currency: ['meta[itemprop="priceCurrency"]'],
    description: ['#tab-description', '.productView-description', '[data-product-description]', '.product-description'],
    images: ['.productView-image img', '.productView-thumbnail img', '.product-image img', 'img.productView-image--default'],
    sku: ['[data-product-sku]', '.productView-info-value--sku', '.product-sku'],
    brand: ['[data-product-brand]', '.productView-info-value--brand', '.product-brand a'],
    availability: ['[data-product-stock]', '.productView-info-value--stock'],
    rating: ['.productView-rating .icon--ratingFull', '.product-rating'],
    reviewCount: ['.productView-reviewLink span', '.product-review-count'],
  },

  categorySelectors: {
    productLinks: ['.card-figure a', '.productGrid a[href]', '.product a.card-figure__link'],
    nextPage: ['.pagination-item--next a', 'a[rel="next"]'],
  },

  productUrlPatterns: ['/products/'],

  variantExtraction: 'click',
  variantSelectors: {
    swatches: ['.productView-optionList .form-option', '[data-product-attribute] .form-option'],
    dropdowns: ['.productView-details select', '[data-product-attribute] select'],
    priceUpdate: ['.productView-price .price--withoutTax'],
  },

  detection: {
    scripts: ['bigcommerce.com/s-', 'stencil-utils'],
    meta: [],
    globals: ['BCData'],
    elements: ['[data-stencil]'],
  },
};
