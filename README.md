# Catalog Ingestion CLI

A Node.js CLI tool that crawls public e-commerce websites, extracts product data, and transforms it into [Product Bus](https://api.adobecommerce.live) JSON format for upload.

## How it works

```
Discovery → Extraction → Transformation → Output → Upload
 (URLs)      (raw data)   (Product Bus)    (JSON)   (API)
```

1. **Discovery** finds product URLs via sitemap parsing, category page crawling, or an explicit URL list
2. **Extraction** opens each page in a headless browser, pulls data from JSON-LD first, then fills gaps from HTML
3. **Transformation** converts raw data into the Product Bus schema (validates required fields, normalizes enums, generates paths)
4. **Output** writes one JSON file per product to disk
5. **Upload** sends products to the Product Bus API in batches of 50

## Requirements

- Node.js 20+
- Chromium (installed automatically by Playwright)

## Installation

```bash
npm install
npx playwright install chromium
```

## Quick start

Crawl a site and extract 10 products:

```bash
node bin/cli.js crawl \
  --url https://www.example-store.com \
  --mode sitemap \
  --max-products 10 \
  --output ./output
```

Validate the output:

```bash
node bin/cli.js upload \
  --input ./output \
  --org my-org \
  --site my-site \
  --dry-run
```

Upload to Product Bus:

```bash
node bin/cli.js upload \
  --input ./output \
  --org my-org \
  --site my-site \
  --api-key {your-api-key}
```

---

## Commands

### `crawl`

Discover and extract product data from a commerce website.

```bash
node bin/cli.js crawl --url <url> [options]
```

| Option | Short | Default | Description |
|---|---|---|---|
| `--url <url>` | `-u` | (required) | Starting URL — homepage, sitemap URL, or category page |
| `--mode <mode>` | `-m` | `sitemap` | Discovery mode: `sitemap`, `category`, or `urls` |
| `--urls-file <path>` | | | Text file with one URL per line (for `--mode urls`) |
| `--output <dir>` | `-o` | `./output` | Directory for output JSON files |
| `--concurrency <n>` | `-c` | `3` | Maximum concurrent browser pages |
| `--delay <ms>` | `-d` | `1500` | Minimum delay between requests (ms) |
| `--max-products <n>` | | unlimited | Stop after this many products |
| `--resume` | `-r` | `false` | Resume from a previous crawl |
| `--state-file <path>` | | `./crawl-state.json` | Path to the crawl state file |
| `--platform <name>` | `-p` | `auto` | Platform hint (see [Platform detection](#platform-detection)) |
| `--no-headless` | | | Show the browser window (useful for debugging) |
| `--user-agent <ua>` | | | Custom user-agent string |
| `--path-prefix <prefix>` | | | Prefix for generated Product Bus paths (e.g., `/us/en`) |
| `--default-currency <code>` | | `USD` | Fallback currency when none is detected |
| `--verbose` | `-v` | `false` | Enable debug-level logging |

#### Discovery modes

**`sitemap`** (default) — Parses the site's XML sitemap(s) to find product URLs. Checks `robots.txt` for sitemap locations first, then tries common paths (`/sitemap.xml`, `/sitemap_index.xml`, etc.). Filters URLs to only include product pages.

```bash
node bin/cli.js crawl --url https://store.example.com --mode sitemap
```

**`category`** — Navigates to a category or collection page and follows pagination to discover product links. Useful when a site has no sitemap or you only want products from a specific category.

```bash
node bin/cli.js crawl --url https://store.example.com/collections/new-arrivals --mode category
```

**`urls`** — Reads product URLs from a text file (one URL per line, `#` for comments, blank lines ignored).

```bash
# urls.txt
https://store.example.com/products/widget-a
https://store.example.com/products/widget-b
# https://store.example.com/products/skip-this-one
```

```bash
node bin/cli.js crawl --url https://store.example.com --mode urls --urls-file urls.txt
```

### `upload`

Upload extracted JSON files to the Product Bus API.

```bash
node bin/cli.js upload --org <org> --site <site> [options]
```

| Option | Short | Default | Description |
|---|---|---|---|
| `--org <org>` | | (required) | Product Bus organization |
| `--site <site>` | | (required) | Product Bus site |
| `--api-key <key>` | | (required*) | API key (*not required for `--dry-run`) |
| `--input <dir>` | `-i` | `./output` | Directory containing product JSON files |
| `--api-url <url>` | | `https://api.adobecommerce.live` | API base URL |
| `--batch-size <n>` | | `50` | Products per batch (max 50) |
| `--dry-run` | | `false` | Validate files without uploading |
| `--verbose` | `-v` | `false` | Enable debug-level logging |

Products are uploaded via `POST /{org}/sites/{site}/catalog/*` in batches of up to 50. The uploader retries on `429` and `5xx` errors with exponential backoff. Auth failures (`401`/`403`) abort immediately.

### `status`

Display progress from a crawl state file.

```bash
node bin/cli.js status [--state-file ./crawl-state.json]
```

Shows discovered, crawled, failed, skipped, and pending counts plus recent failures.

---

## Resuming a crawl

Crawl state is saved to `crawl-state.json` (configurable with `--state-file`). If a crawl is interrupted (Ctrl+C, crash, etc.), the state is automatically saved. Resume with:

```bash
node bin/cli.js crawl --url https://store.example.com --resume
```

This picks up where the previous crawl left off, processing only URLs still in `pending` status.

---

## Platform detection

The tool auto-detects the e-commerce platform and uses platform-specific CSS selectors for optimal extraction. Supported platforms:

| Platform | Detection signals | Variant extraction |
|---|---|---|
| **Shopify** | `window.Shopify`, `cdn.shopify.com` | Embedded JSON blob |
| **Magento / Adobe Commerce** | `form_key` input, `/static/version` | Click-through swatches |
| **BigCommerce** | `window.BCData`, `data-stencil` attributes | Click-through swatches |
| **WooCommerce** | `woocommerce` body class, `wc-` scripts | `data-product_variations` attribute |
| **Generic** | Fallback | Click-through + schema.org microdata |

Override auto-detection with `--platform`:

```bash
node bin/cli.js crawl --url https://my-shopify-store.com --platform shopify
```

---

## Data extraction strategy

For each product page, the tool extracts data in this priority order:

### 1. JSON-LD (primary)

Parses `<script type="application/ld+json">` tags for `schema.org/Product` objects. This is the most reliable source and provides structured data including:
- Product name, SKU, description
- Price and currency (from `offers`)
- Availability and condition
- Images
- Aggregate ratings
- Variants (from multiple `offers`)

### 2. HTML fallback (secondary)

When JSON-LD is missing or incomplete, platform-specific CSS selectors extract data from the DOM:
- `h1` for product name
- Price elements with currency symbol parsing
- Image gallery elements
- Meta tags for SEO fields
- Stock status indicators

### 3. Merge

JSON-LD data takes priority. HTML data fills any gaps. Images are merged and deduplicated by URL.

### 4. Variant extraction

- **Shopify / WooCommerce**: Reads variant data from embedded JSON (no page interaction needed)
- **Magento / BigCommerce / Generic**: Clicks through swatch and dropdown options, capturing price/SKU/image changes after each click
- Variant extraction is capped at 100 per product

---

## Output format

Each product is written as a separate JSON file matching the [Product Bus schema](https://api.adobecommerce.live). File paths mirror the product's URL path:

```
output/
  products/
    cool-widget.json
    fancy-gadget.json
  collections/
    new-arrivals/
      products/
        limited-edition-item.json
```

### Example output

```json
{
  "sku": "CW-001",
  "name": "Cool Widget",
  "path": "/products/cool-widget",
  "url": "https://store.example.com/products/cool-widget",
  "description": "<p>A very cool widget for all your needs.</p>",
  "metaTitle": "Cool Widget | Example Store",
  "metaDescription": "Shop the Cool Widget - available now.",
  "brand": "WidgetCo",
  "price": {
    "currency": "USD",
    "regular": "49.99",
    "final": "39.99"
  },
  "availability": "InStock",
  "images": [
    { "url": "https://cdn.example.com/images/cool-widget-1.jpg", "label": "Front view" },
    { "url": "https://cdn.example.com/images/cool-widget-2.jpg", "label": "Side view" }
  ],
  "aggregateRating": {
    "ratingValue": "4.5",
    "reviewCount": "127"
  },
  "variants": [
    {
      "sku": "CW-001-RED",
      "name": "Cool Widget - Red",
      "url": "https://store.example.com/products/cool-widget?color=red",
      "images": [{ "url": "https://cdn.example.com/images/cool-widget-red.jpg" }],
      "price": { "currency": "USD", "final": "39.99" },
      "availability": "InStock",
      "options": [{ "id": "color", "value": "Red" }]
    }
  ]
}
```

### Product Bus schema reference

| Field | Type | Required | Description |
|---|---|---|---|
| `sku` | string | yes | Unique product identifier |
| `name` | string | yes | Display name |
| `path` | string | yes | URL path (auto-generated from source URL) |
| `url` | string | | Canonical source URL |
| `description` | string | | HTML product description |
| `metaTitle` | string | | SEO title tag |
| `metaDescription` | string | | SEO meta description |
| `brand` | string | | Brand name |
| `gtin` | string | | Barcode / GTIN |
| `price` | object | | `{ currency, regular, final }` (all strings) |
| `availability` | string | | Enum: `InStock`, `OutOfStock`, `PreOrder`, etc. |
| `itemCondition` | string | | Enum: `NewCondition`, `UsedCondition`, etc. |
| `images` | array | | `[{ url, label?, roles? }]` |
| `variants` | array | | `[{ sku, name, url, images, price?, availability?, options? }]` |
| `aggregateRating` | object | | `{ ratingValue, reviewCount }` (strings) |
| `metadata` | object | | Key-value pairs (string values only) |
| `custom` | object | | Freeform data (preserved but not indexed) |

---

## Polite crawling

The tool is designed to be a responsible crawler:

- **robots.txt**: Fetched and respected (honors `Disallow`, `Crawl-delay`)
- **Rate limiting**: Configurable delay between requests (default 1.5s) with random jitter
- **Concurrency**: Low default (3 pages) to avoid overwhelming servers
- **Real browser**: Uses Playwright with a real Chromium instance (not raw HTTP requests), which produces realistic traffic patterns
- **Graceful shutdown**: Ctrl+C saves state immediately so you can resume later

Adjust for sensitive sites:

```bash
# Extra gentle: 1 page at a time, 3-second delay
node bin/cli.js crawl --url https://fragile-site.com -c 1 -d 3000
```

---

## Path generation

Source URLs are converted to valid Product Bus paths:

| Source URL | Generated path |
|---|---|
| `https://store.com/products/cool-widget` | `/products/cool-widget` |
| `https://store.com/PRODUCTS/My-Widget.html` | `/products/my-widget` |
| `https://store.com/shop/category/item%20one` | `/shop/category/item-one` |

Rules applied:
- Protocol, domain, query string, and fragment are stripped
- File extensions (`.html`, `.php`, etc.) are removed
- Uppercase is lowercased
- Special characters become hyphens
- Consecutive hyphens are collapsed
- Maximum 900 characters

Use `--path-prefix` to add a locale or store prefix:

```bash
node bin/cli.js crawl --url https://store.com --path-prefix /us/en
# /products/widget → /us/en/products/widget
```

---

## Examples

### Crawl a Shopify store

```bash
node bin/cli.js crawl \
  --url https://my-shopify-store.myshopify.com \
  --mode sitemap \
  --platform shopify \
  --output ./shopify-products
```

### Crawl a specific category with limited scope

```bash
node bin/cli.js crawl \
  --url https://store.com/collections/sale \
  --mode category \
  --max-products 50 \
  --output ./sale-products
```

### Crawl with a visible browser for debugging

```bash
node bin/cli.js crawl \
  --url https://store.com \
  --max-products 3 \
  --no-headless \
  --verbose
```

### Full pipeline: crawl then upload

```bash
# Step 1: Crawl
node bin/cli.js crawl \
  --url https://store.com \
  --mode sitemap \
  --output ./products \
  --path-prefix /us/en

# Step 2: Validate
node bin/cli.js upload \
  --input ./products \
  --org my-org \
  --site my-site \
  --dry-run

# Step 3: Upload
node bin/cli.js upload \
  --input ./products \
  --org my-org \
  --site my-site \
  --api-key {your-api-key}
```

### Resume an interrupted crawl

```bash
# First run (interrupted with Ctrl+C after 500 products)
node bin/cli.js crawl --url https://large-store.com --output ./products

# Check progress
node bin/cli.js status

# Resume
node bin/cli.js crawl --url https://large-store.com --output ./products --resume
```

---

## Testing

### E2E tests (against live Adobe Store)

```bash
npm run test:e2e
```

Runs 19 tests against `https://www.adobestore.com` covering discovery, platform detection, JSON-LD extraction, HTML extraction, transformation, validation, path generation, full pipeline, and upload dry-run.

### Unit tests

```bash
npm test
```

---

## Project structure

```
catalog-ingestion/
  bin/
    cli.js                     Entry point
  src/
    commands/
      crawl.js                 Crawl command
      upload.js                Upload command
      status.js                Status command
    crawler/
      browser.js               Playwright browser manager
      discovery.js             URL discovery orchestrator
      sitemap.js               XML sitemap parser
      category.js              Category page crawler
      robots.js                robots.txt parser
      state.js                 Persistent crawl state
    extractor/
      index.js                 Extraction orchestrator
      jsonld.js                JSON-LD extraction
      html.js                  HTML fallback extraction
      variants.js              Variant extraction
      platforms/
        index.js               Platform detector
        shopify.js             Shopify selectors
        magento.js             Magento selectors
        bigcommerce.js         BigCommerce selectors
        woocommerce.js         WooCommerce selectors
        generic.js             Generic fallback selectors
    transformer/
      index.js                 Raw data to Product Bus schema
    uploader/
      index.js                 Bulk API upload
    utils/
      logger.js                Colored logging
      progress.js              Spinners and progress bars
      path.js                  URL to Product Bus path
      validation.js            Schema validation
  test/
    e2e/
      adobestore.test.js       E2E tests against live store
    unit/                      Unit tests
    fixtures/                  Test fixtures
```
