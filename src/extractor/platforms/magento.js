export default {
  name: 'magento',

  selectors: {
    productTitle: ['h1.page-title span', 'h1.page-title', '.product-info-main .page-title span', 'h1[itemprop="name"]', 'h1'],
    price: ['.price-wrapper [data-price-amount]', '.product-info-price .price', '.price-box .price', '.special-price .price', 'span[data-price-type="finalPrice"]'],
    salePrice: ['.old-price .price', '.price-box .old-price .price', 'span[data-price-type="oldPrice"]'],
    currency: ['meta[itemprop="priceCurrency"]', '[data-price-amount]'],
    description: ['.product.attribute.description .value', '#description .value', '.product-info-description', '.product.description'],
    images: ['.gallery-placeholder img', '.product.media img', '.fotorama__img', '.product-image-photo', 'img.gallery-placeholder__image'],
    sku: ['.product.attribute.sku .value', '[itemprop="sku"]', '.product-info-stock-sku .sku .value'],
    brand: ['[itemprop="brand"]', '.product-brand', '.product-info-brand'],
    availability: ['.stock.available span', '.stock span', '.product-info-stock-sku .stock'],
    rating: ['.rating-result span span', '.review-summary .rating-result'],
    reviewCount: ['.reviews-actions .action.view span', '.review-count'],
  },

  categorySelectors: {
    productLinks: ['.product-item-link', 'a.product-item-photo', '.product-item a[href*=".html"]'],
    nextPage: ['a.action.next', '.pages-item-next a', 'a[rel="next"]'],
  },

  productUrlPatterns: ['.html'],

  variantExtraction: 'click',
  variantSelectors: {
    swatches: ['.swatch-option', '[data-role="swatch-option"]', '.swatch-attribute'],
    dropdowns: ['select.super-attribute-select', '.product-options-wrapper select'],
    priceUpdate: ['.price-wrapper [data-price-amount]', '.price-box .price'],
  },

  detection: {
    scripts: ['/static/version', 'mage/', 'requirejs/require', 'Magento_'],
    meta: [],
    globals: ['Mage'],
    elements: ['input[name="form_key"]'],
  },
};
