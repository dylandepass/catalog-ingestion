import ora from 'ora';
import cliProgress from 'cli-progress';
import Table from 'cli-table3';
import chalk from 'chalk';

/**
 * Create a styled ora spinner.
 * @param {string} text
 */
export function createSpinner(text) {
  return ora({
    text,
    color: 'cyan',
    spinner: 'dots',
  });
}

/**
 * Create a styled progress bar.
 * @param {number} total
 * @param {string} label
 */
export function createProgressBar(total, label = 'Progress') {
  const bar = new cliProgress.SingleBar({
    format: `${chalk.cyan(label)} ${chalk.cyan('{bar}')} {percentage}% | {value}/{total} | ETA: {eta_formatted}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });
  bar.start(total, 0);
  return bar;
}

/**
 * Create a styled table.
 * @param {string[]} headers
 */
export function createTable(headers) {
  return new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: { head: [], border: ['gray'] },
  });
}

/**
 * Create a key-value table (no headers, just rows).
 */
export function createKeyValueTable() {
  return new Table({
    style: { head: [], border: ['gray'] },
    colWidths: [25, 50],
  });
}
