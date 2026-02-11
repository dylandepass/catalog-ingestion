import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import PQueue from 'p-queue';
import { BrowserManager } from '../crawler/browser.js';
import { CrawlState } from '../crawler/state.js';
import { discoverProducts } from '../crawler/discovery.js';
import { detectPlatform, getPlatformConfig } from '../extractor/platforms/index.js';
import { extractProduct } from '../extractor/index.js';
import { transformProduct } from '../transformer/index.js';
import { createLogger } from '../utils/logger.js';
import { createSpinner, createTable } from '../utils/progress.js';
import { runCatalogServiceCrawl } from './catalog-service.js';

const crawlCommand = new Command('crawl')
  .description('Crawl a commerce website and extract product data')
  .option('-u, --url <url>', 'Starting URL (homepage, sitemap, or category)')
  .option('-m, --mode <mode>', 'Discovery mode: sitemap, category, urls, catalog-service', 'sitemap')
  .option('--urls-file <path>', 'File with URLs (one per line, for --mode urls)')
  .option('-o, --output <dir>', 'Output directory for JSON files', './output')
  .option('-c, --concurrency <n>', 'Max concurrent pages', '3')
  .option('-d, --delay <ms>', 'Delay between requests in ms', '1500')
  .option('--max-products <n>', 'Max products to crawl')
  .option('-r, --resume', 'Resume from previous crawl state', false)
  .option('--state-file <path>', 'Path to state file', './crawl-state.json')
  .option('-p, --platform <name>', 'Platform hint: shopify, magento, bigcommerce, woocommerce, auto', 'auto')
  .option('--no-headless', 'Show the browser window')
  .option('--user-agent <ua>', 'Custom user agent string')
  .option('--path-prefix <prefix>', 'Path prefix for Product Bus paths')
  .option('--default-currency <code>', 'Default currency code', 'USD')
  .option('-v, --verbose', 'Verbose output', false)
  // Catalog Service options
  .option('--cs-endpoint <url>', 'Catalog Service GraphQL endpoint URL')
  .option('--cs-environment-id <id>', 'magento-environment-id header')
  .option('--cs-store-code <code>', 'magento-store-code header', 'main_website_store')
  .option('--cs-store-view-code <code>', 'magento-store-view-code header', 'default')
  .option('--cs-website-code <code>', 'magento-website-code header', 'base')
  .option('--cs-customer-group <hash>', 'magento-customer-group header')
  .option('--cs-api-key <key>', 'x-api-key header', 'not_used')
  .action(async (options) => {
    const logger = createLogger({ verbose: options.verbose });

    // Catalog Service mode — entirely different flow
    if (options.mode === 'catalog-service') {
      return runCatalogServiceCrawl(options, logger);
    }

    // Browser-based modes require a URL
    if (!options.url) {
      logger.error('--url is required for sitemap, category, and urls modes');
      process.exit(1);
    }

    const concurrency = parseInt(options.concurrency, 10) || 3;
    const delay = parseInt(options.delay, 10) || 1500;
    const maxProducts = options.maxProducts ? parseInt(options.maxProducts, 10) : undefined;

    // Display config
    logger.header('Catalog Ingestion - Crawl');

    const configTable = createTable(['Setting', 'Value']);
    configTable.push(
      ['URL', options.url],
      ['Mode', options.mode],
      ['Platform', options.platform],
      ['Output', options.output],
      ['Concurrency', String(concurrency)],
      ['Delay', `${delay}ms`],
      ['Max products', maxProducts ? String(maxProducts) : 'unlimited'],
      ['Resume', options.resume ? 'yes' : 'no'],
      ['Headless', options.headless ? 'yes' : 'no'],
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
        url: options.url,
        mode: options.mode,
        platform: options.platform,
        concurrency,
        delay,
      });

    // Launch browser
    const spinner = createSpinner('Launching browser...');
    spinner.start();
    const browserManager = new BrowserManager({
      headless: options.headless,
      userAgent: options.userAgent,
    });
    await browserManager.launch();
    spinner.succeed('Browser launched');

    // Graceful shutdown handler
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.blank();
      logger.warn('Shutting down gracefully...');
      state.save();
      await browserManager.close();
      logger.success('State saved. Resume with --resume flag.');
      printSummary(logger, state);
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      // Platform detection
      let platformConfig;
      if (options.platform !== 'auto') {
        platformConfig = getPlatformConfig(options.platform);
        logger.info(`Using platform: ${chalk.bold(options.platform)}`);
      } else {
        const detectSpinner = createSpinner('Detecting platform...');
        detectSpinner.start();
        const page = await browserManager.newPage();
        try {
          await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const detected = await detectPlatform(page);
          platformConfig = detected.config;
          state.data.config.platform = detected.platform;
          detectSpinner.succeed(`Detected platform: ${chalk.bold(detected.platform)} (${detected.confidence} confidence)`);
        } catch (err) {
          detectSpinner.warn(`Platform detection failed: ${err.message}. Using generic selectors.`);
          platformConfig = getPlatformConfig('generic');
        } finally {
          await page.close();
        }
      }

      // Discovery phase
      const pendingUrls = state.getPendingUrls();
      if (pendingUrls.length > 0 && options.resume) {
        logger.info(`Resuming with ${pendingUrls.length} pending URLs`);
      } else {
        const discoverSpinner = createSpinner('Discovering product URLs...');
        discoverSpinner.start();

        const discoveredUrls = await discoverProducts(browserManager, {
          url: options.url,
          mode: options.mode,
          urlsFile: options.urlsFile,
          platform: state.data.config.platform || 'generic',
          maxProducts,
          logger,
        });

        state.addUrls(discoveredUrls);
        state.save();
        discoverSpinner.succeed(`Discovered ${chalk.bold(discoveredUrls.length)} product URLs`);
      }

      // Extraction phase
      const urlsToProcess = state.getPendingUrls();
      if (urlsToProcess.length === 0) {
        logger.success('No pending URLs to process.');
        await browserManager.close();
        printSummary(logger, state);
        return;
      }

      logger.blank();
      logger.header('Extracting Products');
      logger.info(`Processing ${urlsToProcess.length} URLs (concurrency: ${concurrency}, delay: ${delay}ms)`);
      logger.blank();

      // Set up the queue with rate limiting
      const queue = new PQueue({
        concurrency,
        interval: delay,
        intervalCap: 1,
      });

      let processed = 0;
      const total = urlsToProcess.length;

      for (const url of urlsToProcess) {
        queue.add(async () => {
          if (shuttingDown) return;

          const page = await browserManager.newPage();
          try {
            // Add random jitter
            const jitter = Math.floor(Math.random() * 500);
            await new Promise((resolve) => { setTimeout(resolve, jitter); });

            const rawData = await extractProduct(page, url, platformConfig, { logger });

            if (rawData) {
              const { product, warnings, errors } = transformProduct(rawData, url, {
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

                state.markCrawled(url);
                processed += 1;

                const statsMsg = chalk.gray(`[${processed}/${total}]`);
                logger.success(`${statsMsg} ${chalk.green(product.name)} ${chalk.dim(`→ ${outputPath}`)}`);

                for (const w of warnings) {
                  logger.warn(`  ${w}`);
                }
              } else {
                state.markFailed(url, errors.join('; '));
                logger.warn(`Failed to transform: ${url} — ${errors.join('; ')}`);
              }
            } else {
              state.markSkipped(url, 'No product data found');
              logger.debug(`Skipped (no data): ${url}`);
            }
          } catch (err) {
            state.markFailed(url, err.message);
            logger.error(`Error processing ${url}: ${err.message}`);
          } finally {
            await page.close();
            // Save state periodically (every 10 products)
            if (processed % 10 === 0) state.save();
          }
        });
      }

      await queue.onIdle();
      state.save();
      await browserManager.close();

      logger.blank();
      printSummary(logger, state);
    } catch (err) {
      logger.error(`Fatal error: ${err.message}`);
      state.save();
      await browserManager.close();
      process.exit(1);
    }
  });

/**
 * Convert a Product Bus path to a file system output path.
 */
function productOutputPath(outputDir, productPath) {
  // /products/cool-widget → output/products/cool-widget.json
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

export default crawlCommand;
