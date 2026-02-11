#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import crawlCommand from '../src/commands/crawl.js';
import uploadCommand from '../src/commands/upload.js';
import statusCommand from '../src/commands/status.js';

const banner = chalk.bold.cyan(`
   ╔═══════════════════════════════════════╗
   ║     Catalog Ingestion CLI v1.0.0      ║
   ║   Commerce Site → Product Bus ETL     ║
   ╚═══════════════════════════════════════╝
`);

program
  .name('catalog-ingestion')
  .description('Crawl commerce websites and ingest products into Product Bus')
  .version('1.0.0')
  .addHelpText('before', banner);

program.addCommand(crawlCommand);
program.addCommand(uploadCommand);
program.addCommand(statusCommand);

program.parse();
