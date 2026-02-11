import assert from 'node:assert';
import { transformProduct } from '../../src/transformer/index.js';

describe('Transformer', function () {
  const baseProduct = {
    name: 'Test Product',
    sku: 'TEST-001',
    price: { currency: 'USD', final: '29.99' },
    images: [{ url: 'https://example.com/img.jpg' }],
  };

  describe('basic transformation', function () {
    it('should transform a minimal product', function () {
      const { product, errors } = transformProduct(
        { name: 'Widget', sku: 'W-1' },
        'https://example.com/products/widget',
      );
      assert.ok(product);
      assert.strictEqual(product.sku, 'W-1');
      assert.strictEqual(product.name, 'Widget');
      assert.strictEqual(product.path, '/products/widget');
      assert.strictEqual(errors.length, 0);
    });

    it('should reject a product without a name', function () {
      const { product, errors } = transformProduct(
        { sku: 'W-1' },
        'https://example.com/products/widget',
      );
      assert.strictEqual(product, null);
      assert.ok(errors.length > 0);
    });

    it('should derive SKU from URL when missing', function () {
      const { product } = transformProduct(
        { name: 'Widget' },
        'https://example.com/products/cool-widget',
      );
      assert.ok(product);
      assert.strictEqual(product.sku, 'COOL-WIDGET');
    });

    it('should normalize availability values', function () {
      const cases = [
        ['InStock', 'InStock'],
        ['in stock', 'InStock'],
        ['https://schema.org/InStock', 'InStock'],
        ['OutOfStock', 'OutOfStock'],
        ['out of stock', 'OutOfStock'],
        ['PreOrder', 'PreOrder'],
        ['pre-order', 'PreOrder'],
        ['SoldOut', 'SoldOut'],
        ['sold out', 'SoldOut'],
      ];
      for (const [input, expected] of cases) {
        const { product } = transformProduct(
          { ...baseProduct, availability: input },
          'https://example.com/products/test',
        );
        assert.strictEqual(product.availability, expected, `${input} → ${expected}`);
      }
    });

    it('should ensure price fields are strings', function () {
      const { product } = transformProduct(
        { ...baseProduct, price: { currency: 'usd', regular: '49.99', final: '29.99' } },
        'https://example.com/products/test',
      );
      assert.strictEqual(product.price.currency, 'USD');
      assert.strictEqual(typeof product.price.regular, 'string');
      assert.strictEqual(typeof product.price.final, 'string');
    });
  });

  describe('top-level options from variants', function () {
    it('should build top-level options from variant options', function () {
      const raw = {
        ...baseProduct,
        variants: [
          { sku: 'V-R-S', name: 'Red Small', url: 'https://example.com/v1', images: [{ url: 'https://example.com/r.jpg' }], options: [{ id: 'color', value: 'Red' }, { id: 'size', value: 'Small' }] },
          { sku: 'V-R-M', name: 'Red Medium', url: 'https://example.com/v2', images: [{ url: 'https://example.com/r.jpg' }], options: [{ id: 'color', value: 'Red' }, { id: 'size', value: 'Medium' }] },
          { sku: 'V-B-S', name: 'Blue Small', url: 'https://example.com/v3', images: [{ url: 'https://example.com/b.jpg' }], options: [{ id: 'color', value: 'Blue' }, { id: 'size', value: 'Small' }] },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/tshirt');

      assert.ok(product.options, 'Should have top-level options');
      assert.strictEqual(product.options.length, 2, 'Should have 2 option types');

      // Color option
      const color = product.options.find((o) => o.id === 'color');
      assert.ok(color, 'Should have color option');
      assert.strictEqual(color.label, 'Color');
      assert.strictEqual(color.position, 1);
      assert.strictEqual(color.values.length, 2);
      assert.deepStrictEqual(color.values.map((v) => v.value), ['Red', 'Blue']);

      // Size option
      const size = product.options.find((o) => o.id === 'size');
      assert.ok(size, 'Should have size option');
      assert.strictEqual(size.label, 'Size');
      assert.strictEqual(size.position, 2);
      assert.strictEqual(size.values.length, 2);
      assert.deepStrictEqual(size.values.map((v) => v.value), ['Small', 'Medium']);
    });

    it('should preserve UIDs in top-level option values', function () {
      const raw = {
        ...baseProduct,
        variants: [
          { sku: 'V-BLK', name: 'Black', url: 'https://example.com/v1', images: [{ url: 'https://example.com/b.jpg' }], options: [{ id: 'color', value: 'Shadow Black', uid: 'uid-blk' }] },
          { sku: 'V-WHT', name: 'White', url: 'https://example.com/v2', images: [{ url: 'https://example.com/w.jpg' }], options: [{ id: 'color', value: 'Polar White', uid: 'uid-wht' }] },
          { sku: 'V-GRY', name: 'Gray', url: 'https://example.com/v3', images: [{ url: 'https://example.com/g.jpg' }], options: [{ id: 'color', value: 'Nano Gray', uid: 'uid-gry' }] },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/widget');

      assert.strictEqual(product.options.length, 1);
      const color = product.options[0];
      assert.strictEqual(color.values.length, 3);
      assert.deepStrictEqual(color.values, [
        { value: 'Shadow Black', uid: 'uid-blk' },
        { value: 'Polar White', uid: 'uid-wht' },
        { value: 'Nano Gray', uid: 'uid-gry' },
      ]);
    });

    it('should preserve per-variant options', function () {
      const raw = {
        ...baseProduct,
        variants: [
          { sku: 'V-1', name: 'V1', url: 'https://example.com/v1', images: [{ url: 'https://example.com/1.jpg' }], options: [{ id: 'color', value: 'Red', uid: 'u1' }] },
          { sku: 'V-2', name: 'V2', url: 'https://example.com/v2', images: [{ url: 'https://example.com/2.jpg' }], options: [{ id: 'color', value: 'Blue', uid: 'u2' }] },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/test');

      // Per-variant options should be preserved
      assert.deepStrictEqual(product.variants[0].options, [{ id: 'color', value: 'Red', uid: 'u1' }]);
      assert.deepStrictEqual(product.variants[1].options, [{ id: 'color', value: 'Blue', uid: 'u2' }]);
    });

    it('should not create options when variants have none', function () {
      const raw = {
        ...baseProduct,
        variants: [
          { sku: 'V-1', name: 'Variant 1', url: 'https://example.com/v1', images: [{ url: 'https://example.com/1.jpg' }] },
          { sku: 'V-2', name: 'Variant 2', url: 'https://example.com/v2', images: [{ url: 'https://example.com/2.jpg' }] },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/test');

      assert.ok(product.variants, 'Should have variants');
      assert.strictEqual(product.options, undefined, 'Should not have options when variants lack them');
    });

    it('should deduplicate option values across variants', function () {
      const raw = {
        ...baseProduct,
        variants: [
          { sku: 'V-1', name: 'V1', url: 'https://example.com/v1', images: [{ url: 'https://example.com/1.jpg' }], options: [{ id: 'size', value: 'Large' }] },
          { sku: 'V-2', name: 'V2', url: 'https://example.com/v2', images: [{ url: 'https://example.com/2.jpg' }], options: [{ id: 'size', value: 'Large' }] },
          { sku: 'V-3', name: 'V3', url: 'https://example.com/v3', images: [{ url: 'https://example.com/3.jpg' }], options: [{ id: 'size', value: 'Small' }] },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/test');

      assert.strictEqual(product.options.length, 1);
      assert.strictEqual(product.options[0].values.length, 2, 'Should deduplicate "Large"');
      assert.deepStrictEqual(product.options[0].values.map((v) => v.value), ['Large', 'Small']);
    });

    it('should handle multiple option dimensions', function () {
      const raw = {
        ...baseProduct,
        variants: [
          { sku: 'V-1', name: 'V1', url: 'https://example.com/v1', images: [{ url: 'https://example.com/1.jpg' }], options: [{ id: 'color', value: 'Red' }, { id: 'size', value: 'S' }, { id: 'material', value: 'Cotton' }] },
          { sku: 'V-2', name: 'V2', url: 'https://example.com/v2', images: [{ url: 'https://example.com/2.jpg' }], options: [{ id: 'color', value: 'Blue' }, { id: 'size', value: 'M' }, { id: 'material', value: 'Polyester' }] },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/test');

      assert.strictEqual(product.options.length, 3);
      assert.strictEqual(product.options[0].id, 'color');
      assert.strictEqual(product.options[0].position, 1);
      assert.strictEqual(product.options[1].id, 'size');
      assert.strictEqual(product.options[1].position, 2);
      assert.strictEqual(product.options[2].id, 'material');
      assert.strictEqual(product.options[2].position, 3);
    });
  });

  describe('variant transformation', function () {
    it('should fall back to parent images when variant has none', function () {
      const raw = {
        ...baseProduct,
        variants: [
          { sku: 'V-1', name: 'V1', url: 'https://example.com/v1', images: [] },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/test');

      assert.ok(product.variants);
      assert.strictEqual(product.variants[0].images.length, 1);
      assert.strictEqual(product.variants[0].images[0].url, 'https://example.com/img.jpg');
    });

    it('should drop variants with no images at all', function () {
      const raw = {
        name: 'No Images',
        sku: 'NI-1',
        variants: [
          { sku: 'V-1', name: 'V1', url: 'https://example.com/v1', images: [] },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/test');

      // Variant dropped because no images available (parent has none either)
      assert.ok(product);
      assert.strictEqual(product.variants, undefined);
    });

    it('should inherit currency from parent when variant lacks it', function () {
      const raw = {
        ...baseProduct,
        variants: [
          { sku: 'V-1', name: 'V1', url: 'https://example.com/v1', images: [{ url: 'https://example.com/1.jpg' }], price: { final: '19.99' } },
        ],
      };

      const { product } = transformProduct(raw, 'https://example.com/products/test');

      assert.strictEqual(product.variants[0].price.currency, 'USD');
    });
  });
});
