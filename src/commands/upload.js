import { Command } from 'commander';
import chalk from 'chalk';
import { ProductBusUploader } from '../uploader/index.js';
import { createLogger } from '../utils/logger.js';
import { createProgressBar, createTable } from '../utils/progress.js';

const uploadCommand = new Command('upload')
  .description('Upload extracted product JSON files to Product Bus')
  .requiredOption('--org <org>', 'Product Bus organization')
  .requiredOption('--site <site>', 'Product Bus site')
  .option('--api-key <key>', 'API key for authentication')
  .option('-i, --input <dir>', 'Input directory with JSON files', './output')
  .option('--api-url <url>', 'API base URL', 'https://api.adobecommerce.live')
  .option('--batch-size <n>', 'Products per batch (max 50)', '50')
  .option('--dry-run', 'Validate without uploading', false)
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (options) => {
    const logger = createLogger({ verbose: options.verbose });

    if (!options.dryRun && !options.apiKey) {
      logger.error('--api-key is required for uploading (use --dry-run to validate only)');
      process.exit(1);
    }

    logger.header('Product Bus Upload');

    const batchSize = Math.min(parseInt(options.batchSize, 10) || 50, 50);

    // Display config
    const configTable = createTable(['Setting', 'Value']);
    configTable.push(
      ['Input', options.input],
      ['Organization', options.org],
      ['Site', options.site],
      ['API URL', options.apiUrl],
      ['Batch size', String(batchSize)],
      ['Mode', options.dryRun ? chalk.yellow('DRY RUN') : chalk.green('LIVE')],
    );
    console.log(configTable.toString());
    logger.blank();

    const uploader = new ProductBusUploader({
      org: options.org,
      site: options.site,
      apiKey: options.apiKey || '',
      apiUrl: options.apiUrl,
      batchSize,
      dryRun: options.dryRun,
      logger,
    });

    let bar;
    const result = await uploader.uploadAll(options.input, {
      onProgress: (done, total) => {
        if (!bar) bar = createProgressBar(total, 'Uploading');
        bar.update(done);
      },
    });

    if (bar) bar.stop();
    logger.blank();

    // Summary
    logger.header('Upload Summary');
    const summaryTable = createTable(['Metric', 'Count']);
    summaryTable.push(
      ['Total files', String(result.total)],
      [chalk.green('Uploaded'), String(result.uploaded)],
      [chalk.red('Failed'), String(result.failed)],
      [chalk.yellow('Skipped'), String(result.skipped)],
    );
    console.log(summaryTable.toString());

    if (result.errors.length > 0) {
      logger.blank();
      logger.header('Errors');
      for (const err of result.errors.slice(0, 20)) {
        console.log(`  ${chalk.red('x')} ${err}`);
      }
      if (result.errors.length > 20) {
        console.log(chalk.gray(`  ... and ${result.errors.length - 20} more`));
      }
    }

    if (result.failed > 0) {
      process.exit(1);
    }
  });

export default uploadCommand;
