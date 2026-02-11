import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { CatalogServiceClient } from '../catalog-service/client.js';
import { normalizeProduct } from '../catalog-service/normalizer.js';
import { transformProduct } from '../transformer/index.js';
import { CrawlState } from '../crawler/state.js';
import { createSpinner, createTable } from '../utils/progress.js';

/**
 * Run a catalog-service mode crawl.
 * Pulls product data directly from the Adobe Commerce Catalog Service GraphQL API.
 *
 * @param {object} options - CLI options
 * @param {object} logger - Logger instance
 */
export async function runCatalogServiceCrawl(options, logger) {
  const maxProducts = options.maxProducts ? parseInt(options.maxProducts, 10) : undefined;

  // Validate required options
  if (!options.csEndpoint) {
    logger.error('--cs-endpoint is required for catalog-service mode');
    process.exit(1);
  }
  if (!options.csEnvironmentId) {
    logger.error('--cs-environment-id is required for catalog-service mode');
    process.exit(1);
  }

  // Display config
  logger.header('Catalog Ingestion - Catalog Service Mode');

  const configTable = createTable(['Setting', 'Value']);
  configTable.push(
    ['Endpoint', options.csEndpoint],
    ['Environment ID', options.csEnvironmentId],
    ['Store Code', options.csStoreCode || 'main_website_store'],
    ['Store View Code', options.csStoreViewCode || 'default'],
    ['Website Code', options.csWebsiteCode || 'base'],
    ['Customer Group', options.csCustomerGroup || '(not set)'],
    ['Output', options.output],
    ['Max products', maxProducts ? String(maxProducts) : 'unlimited'],
  );
  console.log(configTable.toString());
  logger.blank();

  // Ensure output directory exists
  if (!fs.existsSync(options.output)) {
    fs.mkdirSync(options.output, { recursive: true });
  }

  // Load or create crawl state
  const state = options.resume
    ? CrawlState.load(options.stateFile)
    : CrawlState.load(options.stateFile, {
      url: options.csEndpoint,
      mode: 'catalog-service',
      platform: 'adobe-commerce',
    });

  // Create the GraphQL client
  const client = new CatalogServiceClient({
    endpoint: options.csEndpoint,
    environmentId: options.csEnvironmentId,
    storeCode: options.csStoreCode || 'main_website_store',
    storeViewCode: options.csStoreViewCode || 'default',
    websiteCode: options.csWebsiteCode || 'base',
    customerGroup: options.csCustomerGroup,
    apiKey: options.csApiKey || 'not_used',
    logger,
  });

  // Derive a base URL from the endpoint for building product URLs
  // The endpoint is like: https://edge-graph.adobe.io/api/{id}/graphql
  // We'll use the origin header or let the user's --url provide it
  const baseUrl = options.url || '';

  // Graceful shutdown handler
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.blank();
    logger.warn('Shutting down gracefully...');
    state.save();
    logger.success('State saved. Resume with --resume flag.');
    printSummary(logger, state);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    // Phase 1: Discover all product SKUs
    let productList;
    const pendingUrls = state.getPendingUrls();

    if (pendingUrls.length > 0 && options.resume) {
      logger.info(`Resuming with ${pendingUrls.length} pending products`);
      // In catalog-service mode, URLs in state are actually SKUs
      productList = pendingUrls.map((sku) => ({ sku, name: sku, urlKey: '' }));
    } else {
      const discoverSpinner = createSpinner('Discovering products from Catalog Service...');
      discoverSpinner.start();

      productList = await client.listAllProducts({
        maxProducts,
        onPage: (page, total) => {
          discoverSpinner.text = `Discovering products... (page ${page}/${total})`;
        },
      });

      // Use SKUs as the "URL" keys in the state
      const skus = productList.map((p) => p.sku);
      state.addUrls(skus);
      state.save();
      discoverSpinner.succeed(`Discovered ${chalk.bold(productList.length)} products`);
    }

    // Phase 2: Fetch product details in batches
    const skusToProcess = options.resume
      ? state.getPendingUrls()
      : productList.map((p) => p.sku);

    if (skusToProcess.length === 0) {
      logger.success('No pending products to process.');
      printSummary(logger, state);
      return;
    }

    logger.blank();
    logger.header('Fetching Product Details');
    logger.info(`Processing ${skusToProcess.length} products`);
    logger.blank();

    // Batch-fetch all product details
    const fetchSpinner = createSpinner('Fetching product details...');
    fetchSpinner.start();

    const productViews = await client.fetchProducts(skusToProcess, {
      onBatch: (batch, total) => {
        fetchSpinner.text = `Fetching product details... (batch ${batch}/${total})`;
      },
    });

    fetchSpinner.succeed(`Fetched details for ${chalk.bold(productViews.length)} products`);

    // Build a SKU → productView lookup
    const productMap = new Map();
    for (const pv of productViews) {
      productMap.set(pv.sku, pv);
    }

    // Phase 3: Fetch variants for complex products + normalize + transform
    logger.blank();
    logger.header('Processing Products');

    let processed = 0;
    let failed = 0;
    const total = skusToProcess.length;

    for (const sku of skusToProcess) {
      if (shuttingDown) break;

      const productView = productMap.get(sku);
      if (!productView) {
        state.markFailed(sku, 'Product not found in Catalog Service');
        failed += 1;
        logger.warn(`[${processed + failed}/${total}] Product not found: ${sku}`);
        continue;
      }

      try {
        // Fetch variants if it's a complex product
        let variantsData = null;
        if (productView.__typename === 'ComplexProductView') {
          variantsData = await client.fetchVariants(sku);
        }

        // Normalize to intermediate format
        const rawData = normalizeProduct(productView, variantsData, baseUrl);

        // Build a source URL for the transformer (used for path generation)
        const sourceUrl = rawData.url
          || (baseUrl ? `${baseUrl}/products/${productView.urlKey || sku.toLowerCase()}` : `https://example.com/products/${productView.urlKey || sku.toLowerCase()}`);

        // Transform to Product Bus schema
        const { product, warnings, errors } = transformProduct(rawData, sourceUrl, {
          pathPrefix: options.pathPrefix,
          defaultCurrency: options.defaultCurrency,
        });

        if (product) {
          // Write JSON file
          const outputPath = productOutputPath(options.output, product.path);
          const outputDir = path.dirname(outputPath);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          fs.writeFileSync(outputPath, JSON.stringify(product, null, 2));

          state.markCrawled(sku);
          processed += 1;

          const variantCount = product.variants?.length || 0;
          const variantMsg = variantCount > 0 ? chalk.dim(` (${variantCount} variants)`) : '';
          const statsMsg = chalk.gray(`[${processed}/${total}]`);
          logger.success(`${statsMsg} ${chalk.green(product.name)}${variantMsg} ${chalk.dim(`→ ${outputPath}`)}`);

          for (const w of warnings) {
            logger.warn(`  ${w}`);
          }
        } else {
          state.markFailed(sku, errors.join('; '));
          failed += 1;
          logger.warn(`Failed to transform: ${sku} — ${errors.join('; ')}`);
        }
      } catch (err) {
        state.markFailed(sku, err.message);
        failed += 1;
        logger.error(`Error processing ${sku}: ${err.message}`);
      }

      // Save state periodically
      if ((processed + failed) % 10 === 0) state.save();
    }

    state.save();
    logger.blank();
    printSummary(logger, state);
  } catch (err) {
    logger.error(`Fatal error: ${err.message}`);
    state.save();
    process.exit(1);
  }
}

/**
 * Convert a Product Bus path to a file system output path.
 */
function productOutputPath(outputDir, productPath) {
  const relative = productPath.startsWith('/') ? productPath.slice(1) : productPath;
  return path.join(outputDir, `${relative}.json`);
}

/**
 * Print a summary of the crawl results.
 */
function printSummary(logger, state) {
  logger.header('Crawl Summary');
  const stats = state.getStats();
  const summaryTable = createTable(['Metric', 'Count']);
  summaryTable.push(
    ['Discovered', String(stats.discovered)],
    [chalk.green('Crawled'), String(stats.crawled)],
    [chalk.red('Failed'), String(stats.failed)],
    [chalk.yellow('Skipped'), String(stats.skipped)],
    [chalk.gray('Pending'), String(stats.discovered - stats.crawled - stats.failed - stats.skipped)],
  );
  console.log(summaryTable.toString());
}
