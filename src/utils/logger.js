import chalk from 'chalk';

/**
 * Create a logger instance with optional verbose mode.
 * @param {{ verbose?: boolean }} options
 */
export function createLogger(options = {}) {
  const { verbose = false } = options;

  const timestamp = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return chalk.dim(`[${h}:${m}:${s}]`);
  };

  return {
    info(msg) {
      console.log(`${timestamp()} ${chalk.blue('INFO')}  ${msg}`);
    },
    success(msg) {
      console.log(`${timestamp()} ${chalk.green('OK')}    ${msg}`);
    },
    warn(msg) {
      console.log(`${timestamp()} ${chalk.yellow('WARN')}  ${msg}`);
    },
    error(msg) {
      console.error(`${timestamp()} ${chalk.red('ERROR')} ${msg}`);
    },
    debug(msg) {
      if (verbose) {
        console.log(`${timestamp()} ${chalk.gray('DEBUG')} ${msg}`);
      }
    },
    header(msg) {
      console.log(`\n${chalk.bold.cyan(msg)}`);
      console.log(chalk.cyan('─'.repeat(msg.length)));
    },
    blank() {
      console.log();
    },
  };
}

/** Default logger (non-verbose) */
export default createLogger();
