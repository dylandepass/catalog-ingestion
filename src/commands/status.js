import { Command } from 'commander';
import chalk from 'chalk';
import { CrawlState } from '../crawler/state.js';
import { createKeyValueTable, createTable } from '../utils/progress.js';
import { createLogger } from '../utils/logger.js';

const statusCommand = new Command('status')
  .description('Show crawl progress from the state file')
  .option('--state-file <path>', 'Path to crawl state file', './crawl-state.json')
  .action(async (options) => {
    const logger = createLogger();

    let state;
    try {
      state = CrawlState.load(options.stateFile);
    } catch (err) {
      logger.error(`Failed to load state file: ${err.message}`);
      logger.info('Run "catalog-ingestion crawl" first to create a crawl state.');
      process.exit(1);
    }

    const stats = state.getStats();
    const data = state.data;

    if (stats.discovered === 0) {
      logger.info('No crawl data found. Run "catalog-ingestion crawl" first.');
      return;
    }

    logger.header('Crawl Status');

    // Config table
    const configTable = createKeyValueTable();
    configTable.push(
      [chalk.bold('Started'), data.startedAt || 'N/A'],
      [chalk.bold('Last updated'), data.lastUpdatedAt || 'N/A'],
      [chalk.bold('Mode'), data.config?.mode || 'N/A'],
      [chalk.bold('URL'), data.config?.url || 'N/A'],
      [chalk.bold('Platform'), data.config?.platform || 'N/A'],
    );
    console.log(configTable.toString());

    logger.blank();
    logger.header('Progress');

    const pending = stats.discovered - stats.crawled - stats.failed - stats.skipped;
    const pct = (n) => stats.discovered > 0 ? `${((n / stats.discovered) * 100).toFixed(1)}%` : '0%';

    const progressTable = createTable(['Status', 'Count', 'Percentage']);
    progressTable.push(
      [chalk.blue('Discovered'), String(stats.discovered), '100%'],
      [chalk.green('Crawled'), String(stats.crawled), pct(stats.crawled)],
      [chalk.red('Failed'), String(stats.failed), pct(stats.failed)],
      [chalk.yellow('Skipped'), String(stats.skipped), pct(stats.skipped)],
      [chalk.gray('Pending'), String(pending), pct(pending)],
    );
    console.log(progressTable.toString());

    // Show recent failures
    const failedUrls = Object.entries(data.urls)
      .filter(([, entry]) => entry.status === 'failed')
      .slice(0, 10);

    if (failedUrls.length > 0) {
      logger.blank();
      logger.header('Recent Failures');
      for (const [url, entry] of failedUrls) {
        console.log(`  ${chalk.red('x')} ${url}`);
        if (entry.error) console.log(`    ${chalk.gray(entry.error)}`);
      }
    }

    if (state.isComplete()) {
      logger.blank();
      logger.success('Crawl complete!');
    }
  });

export default statusCommand;
