import assert from 'node:assert';
import { normalizeProduct } from '../../src/catalog-service/normalizer.js';

describe('Catalog Service Normalizer', function () {
  describe('SimpleProductView', function () {
    it('should normalize a simple product', function () {
      const productView = {
        __typename: 'SimpleProductView',
        sku: 'ADB119',
        name: 'Denim apron',
        urlKey: 'denim-apronp-adb119',
        description: '<div><b>Nice apron</b></div>',
        inStock: true,
        images: [
          { url: 'https://example.com/img.jpg', label: 'Front', roles: ['image'] },
        ],
        price: {
          final: { amount: { value: 49, currency: 'USD' } },
          regular: { amount: { value: 59, currency: 'USD' } },
        },
        attributes: [],
      };

      const result = normalizeProduct(productView, null, 'https://www.example.com');

      assert.strictEqual(result.name, 'Denim apron');
      assert.strictEqual(result.sku, 'ADB119');
      assert.strictEqual(result.description, 'Nice apron');
      assert.strictEqual(result.availability, 'InStock');
      assert.deepStrictEqual(result.price, { final: '49', regular: '59', currency: 'USD' });
      assert.strictEqual(result.images.length, 1);
      assert.strictEqual(result.images[0].url, 'https://example.com/img.jpg');
      assert.strictEqual(result.images[0].label, 'Front');
      assert.strictEqual(result.variants, undefined);
    });

    it('should set OutOfStock when inStock is false', function () {
      const productView = {
        __typename: 'SimpleProductView',
        sku: 'TEST-1',
        name: 'Out of stock item',
        inStock: false,
      };

      const result = normalizeProduct(productView);
      assert.strictEqual(result.availability, 'OutOfStock');
    });

    it('should build URL from urlKey and baseUrl', function () {
      const productView = {
        __typename: 'SimpleProductView',
        sku: 'TEST-2',
        name: 'Test',
        urlKey: 'my-product',
      };

      const result = normalizeProduct(productView, null, 'https://www.store.com');
      assert.strictEqual(result.url, 'https://www.store.com/products/my-product/test-2');
    });

    it('should strip HTML from description', function () {
      const productView = {
        __typename: 'SimpleProductView',
        sku: 'TEST-3',
        name: 'Test',
        description: '<div><b>Bold</b><br>\nLine two.<br><br>\nParagraph two.</div>',
      };

      const result = normalizeProduct(productView);
      assert.ok(!result.description.includes('<'));
      assert.ok(result.description.includes('Bold'));
      assert.ok(result.description.includes('Paragraph two'));
    });

    it('should normalize protocol-relative image URLs', function () {
      const productView = {
        __typename: 'SimpleProductView',
        sku: 'TEST-4',
        name: 'Test',
        images: [{ url: '//cdn.example.com/img.jpg' }],
      };

      const result = normalizeProduct(productView);
      assert.strictEqual(result.images[0].url, 'https://cdn.example.com/img.jpg');
    });
  });

  describe('ComplexProductView', function () {
    const complexProduct = {
      __typename: 'ComplexProductView',
      sku: 'ADB449',
      name: "Women's Bezier tee - White",
      urlKey: 'p-adb449',
      description: '<div>Nice tee</div>',
      inStock: true,
      images: [
        { url: 'https://example.com/tee.jpg', label: '', roles: ['image', 'thumbnail'] },
      ],
      priceRange: {
        minimum: {
          final: { amount: { value: 25, currency: 'USD' } },
          regular: { amount: { value: 25, currency: 'USD' } },
        },
        maximum: {
          final: { amount: { value: 25, currency: 'USD' } },
          regular: { amount: { value: 25, currency: 'USD' } },
        },
      },
      options: [
        {
          id: 'color',
          title: 'Color',
          values: [
            { id: 'uid-color-white', title: 'White', inStock: true },
          ],
        },
        {
          id: 'size',
          title: 'Size',
          values: [
            { id: 'uid-size-xs', title: 'X-Small', inStock: true },
            { id: 'uid-size-sm', title: 'Small', inStock: true },
            { id: 'uid-size-md', title: 'Medium', inStock: true },
          ],
        },
      ],
    };

    const variantsData = [
      {
        selections: ['uid-color-white', 'uid-size-xs'],
        product: {
          sku: 'ADB449.WHT-XS',
          name: 'TEE -WHT-XS',
          inStock: true,
          images: [],
          price: {
            final: { amount: { value: 25, currency: 'USD' } },
            regular: { amount: { value: 25, currency: 'USD' } },
          },
        },
      },
      {
        selections: ['uid-color-white', 'uid-size-sm'],
        product: {
          sku: 'ADB449.WHT-SM',
          name: 'TEE -WHT-SM',
          inStock: true,
          images: [{ url: 'https://example.com/sm.jpg', label: 'Small' }],
          price: {
            final: { amount: { value: 25, currency: 'USD' } },
            regular: { amount: { value: 25, currency: 'USD' } },
          },
        },
      },
      {
        selections: ['uid-size-md', 'uid-color-white'],
        product: {
          sku: 'ADB449.WHT-MD',
          name: 'TEE -WHT-MD',
          inStock: false,
          images: [],
          price: {
            final: { amount: { value: 30, currency: 'USD' } },
          },
        },
      },
    ];

    it('should extract price from priceRange', function () {
      const result = normalizeProduct(complexProduct, variantsData, 'https://example.com');
      assert.deepStrictEqual(result.price, { final: '25', regular: '25', currency: 'USD' });
    });

    it('should create variants with correct option mapping', function () {
      const result = normalizeProduct(complexProduct, variantsData, 'https://example.com');

      assert.strictEqual(result.variants.length, 3);

      // First variant: White + X-Small
      const v1 = result.variants[0];
      assert.strictEqual(v1.sku, 'ADB449.WHT-XS');
      assert.strictEqual(v1.options.length, 2);
      assert.deepStrictEqual(v1.options[0], { id: 'color', value: 'White', uid: 'uid-color-white' });
      assert.deepStrictEqual(v1.options[1], { id: 'size', value: 'X-Small', uid: 'uid-size-xs' });

      // Second variant: White + Small
      const v2 = result.variants[1];
      assert.strictEqual(v2.sku, 'ADB449.WHT-SM');
      assert.strictEqual(v2.options.length, 2);
      assert.deepStrictEqual(v2.options[1], { id: 'size', value: 'Small', uid: 'uid-size-sm' });

      // Third variant: White + Medium (selections in reverse order)
      const v3 = result.variants[2];
      assert.strictEqual(v3.sku, 'ADB449.WHT-MD');
      assert.strictEqual(v3.options.length, 2);
      // Should still find both options regardless of selection order
      assert.ok(v3.options.some((o) => o.id === 'color' && o.value === 'White'));
      assert.ok(v3.options.some((o) => o.id === 'size' && o.value === 'Medium'));
    });

    it('should set per-variant availability', function () {
      const result = normalizeProduct(complexProduct, variantsData, 'https://example.com');

      assert.strictEqual(result.variants[0].availability, 'InStock');
      assert.strictEqual(result.variants[2].availability, 'OutOfStock');
    });

    it('should fall back to parent images when variant has none', function () {
      const result = normalizeProduct(complexProduct, variantsData, 'https://example.com');

      // Variant 1 has no images → should get parent image
      assert.strictEqual(result.variants[0].images.length, 1);
      assert.strictEqual(result.variants[0].images[0].url, 'https://example.com/tee.jpg');

      // Variant 2 has its own image
      assert.strictEqual(result.variants[1].images.length, 1);
      assert.strictEqual(result.variants[1].images[0].url, 'https://example.com/sm.jpg');
    });

    it('should handle variant-specific prices', function () {
      const result = normalizeProduct(complexProduct, variantsData, 'https://example.com');

      // Variant 3 has a different price
      assert.deepStrictEqual(result.variants[2].price, { final: '30', currency: 'USD' });
    });

    it('should not create variants when no variant data provided', function () {
      const result = normalizeProduct(complexProduct, null, 'https://example.com');
      assert.strictEqual(result.variants, undefined);
    });

    it('should not create variants when variant data is empty', function () {
      const result = normalizeProduct(complexProduct, [], 'https://example.com');
      assert.strictEqual(result.variants, undefined);
    });
  });

  describe('edge cases', function () {
    it('should handle product with no images', function () {
      const productView = {
        __typename: 'SimpleProductView',
        sku: 'BARE',
        name: 'Bare Product',
        images: [],
      };

      const result = normalizeProduct(productView);
      assert.strictEqual(result.name, 'Bare Product');
      assert.strictEqual(result.images, undefined);
    });

    it('should extract brand from attributes', function () {
      const productView = {
        __typename: 'SimpleProductView',
        sku: 'BRAND-1',
        name: 'Branded Item',
        attributes: [
          { name: 'weight', value: '0.5' },
          { name: 'brand', value: 'Adobe' },
        ],
      };

      const result = normalizeProduct(productView);
      assert.strictEqual(result.brand, 'Adobe');
    });

    it('should preserve metaTitle and metaDescription', function () {
      const productView = {
        __typename: 'SimpleProductView',
        sku: 'META-1',
        name: 'Meta Product',
        metaTitle: 'Buy Meta Product',
        metaDescription: 'Best product ever',
      };

      const result = normalizeProduct(productView);
      assert.strictEqual(result.metaTitle, 'Buy Meta Product');
      assert.strictEqual(result.metaDescription, 'Best product ever');
    });
  });
});
