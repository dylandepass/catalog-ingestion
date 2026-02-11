import assert from 'node:assert';

// We can't easily test extractJsonLd without a browser page,
// but we can test the normalizer by importing and calling it indirectly.
// Instead, test the full round-trip through transformer with JSON-LD-like data.

import { transformProduct } from '../../src/transformer/index.js';

describe('JSON-LD → Transformer (hasVariant options)', function () {
  it('should produce options from hasVariant with additionalProperty', function () {
    // Simulates what the JSON-LD extractor produces from a hasVariant structure
    const raw = {
      name: 'Canvas Sneaker',
      sku: 'SNKR-001',
      price: { currency: 'EUR', final: '89.00' },
      images: [{ url: 'https://example.com/sneaker.jpg' }],
      variants: [
        {
          sku: 'SNKR-001-WHT-40',
          name: 'Canvas Sneaker - White / 40',
          url: 'https://example.com/sneaker?color=white&size=40',
          images: [{ url: 'https://example.com/sneaker-white.jpg' }],
          price: { currency: 'EUR', final: '89.00' },
          availability: 'InStock',
          options: [{ id: 'color', value: 'White' }, { id: 'size', value: '40' }],
        },
        {
          sku: 'SNKR-001-WHT-42',
          name: 'Canvas Sneaker - White / 42',
          url: 'https://example.com/sneaker?color=white&size=42',
          images: [{ url: 'https://example.com/sneaker-white.jpg' }],
          price: { currency: 'EUR', final: '89.00' },
          availability: 'InStock',
          options: [{ id: 'color', value: 'White' }, { id: 'size', value: '42' }],
        },
        {
          sku: 'SNKR-001-BLK-40',
          name: 'Canvas Sneaker - Black / 40',
          url: 'https://example.com/sneaker?color=black&size=40',
          images: [{ url: 'https://example.com/sneaker-black.jpg' }],
          price: { currency: 'EUR', final: '89.00' },
          availability: 'OutOfStock',
          options: [{ id: 'color', value: 'Black' }, { id: 'size', value: '40' }],
        },
        {
          sku: 'SNKR-001-BLK-42',
          name: 'Canvas Sneaker - Black / 42',
          url: 'https://example.com/sneaker?color=black&size=42',
          images: [{ url: 'https://example.com/sneaker-black.jpg' }],
          price: { currency: 'EUR', final: '99.00' },
          availability: 'InStock',
          options: [{ id: 'color', value: 'Black' }, { id: 'size', value: '42' }],
        },
      ],
    };

    const { product, errors } = transformProduct(raw, 'https://example.com/products/canvas-sneaker');
    assert.strictEqual(errors.length, 0);
    assert.ok(product);

    // Top-level options
    assert.ok(product.options, 'Should have top-level options');
    assert.strictEqual(product.options.length, 2);

    const colorOpt = product.options[0];
    assert.strictEqual(colorOpt.id, 'color');
    assert.strictEqual(colorOpt.label, 'Color');
    assert.strictEqual(colorOpt.values.length, 2);
    assert.deepStrictEqual(colorOpt.values.map((v) => v.value), ['White', 'Black']);

    const sizeOpt = product.options[1];
    assert.strictEqual(sizeOpt.id, 'size');
    assert.strictEqual(sizeOpt.label, 'Size');
    assert.strictEqual(sizeOpt.values.length, 2);
    assert.deepStrictEqual(sizeOpt.values.map((v) => v.value), ['40', '42']);

    // Per-variant options
    assert.strictEqual(product.variants.length, 4);
    assert.deepStrictEqual(product.variants[0].options, [
      { id: 'color', value: 'White' },
      { id: 'size', value: '40' },
    ]);
    assert.deepStrictEqual(product.variants[2].options, [
      { id: 'color', value: 'Black' },
      { id: 'size', value: '40' },
    ]);
  });

  it('should produce options from offers-based variants when they have options', function () {
    // Simulates what happens when Shopify variants come through with option data
    const raw = {
      name: 'Graphic Tee',
      sku: 'GT-100',
      price: { currency: 'USD', final: '24.99' },
      images: [{ url: 'https://example.com/tee.jpg' }],
      variants: [
        { sku: 'GT-100-S', name: 'Small', url: 'https://example.com/tee?v=1', images: [{ url: 'https://example.com/tee.jpg' }], price: { final: '24.99' }, options: [{ id: 'size', value: 'S' }] },
        { sku: 'GT-100-M', name: 'Medium', url: 'https://example.com/tee?v=2', images: [{ url: 'https://example.com/tee.jpg' }], price: { final: '24.99' }, options: [{ id: 'size', value: 'M' }] },
        { sku: 'GT-100-L', name: 'Large', url: 'https://example.com/tee?v=3', images: [{ url: 'https://example.com/tee.jpg' }], price: { final: '24.99' }, options: [{ id: 'size', value: 'L' }] },
        { sku: 'GT-100-XL', name: 'XL', url: 'https://example.com/tee?v=4', images: [{ url: 'https://example.com/tee.jpg' }], price: { final: '27.99' }, options: [{ id: 'size', value: 'XL' }] },
      ],
    };

    const { product } = transformProduct(raw, 'https://example.com/products/graphic-tee');

    assert.ok(product.options);
    assert.strictEqual(product.options.length, 1);
    assert.strictEqual(product.options[0].id, 'size');
    assert.strictEqual(product.options[0].values.length, 4);
    assert.deepStrictEqual(
      product.options[0].values.map((v) => v.value),
      ['S', 'M', 'L', 'XL'],
    );
  });

  it('should not add options when product has no variants', function () {
    const raw = {
      name: 'Simple Product',
      sku: 'SP-001',
      price: { currency: 'USD', final: '9.99' },
    };

    const { product } = transformProduct(raw, 'https://example.com/products/simple');
    assert.strictEqual(product.options, undefined);
    assert.strictEqual(product.variants, undefined);
  });
});
