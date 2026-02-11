import { chromium } from 'playwright';

/**
 * Manage Playwright browser lifecycle.
 */
export class BrowserManager {
  /**
   * @param {{ headless?: boolean, userAgent?: string }} [options]
   */
  constructor(options = {}) {
    this.options = {
      headless: true,
      userAgent: null,
      ...options,
    };
    this.browser = null;
    this.context = null;
  }

  /** Launch the browser. */
  async launch() {
    this.browser = await chromium.launch({
      headless: this.options.headless,
    });

    const contextOptions = {
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      javaScriptEnabled: true,
    };

    if (this.options.userAgent) {
      contextOptions.userAgent = this.options.userAgent;
    }

    this.context = await this.browser.newContext(contextOptions);

    // Stealth: override navigator.webdriver
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    return this;
  }

  /**
   * Create a new page in the browser context.
   * @param {{ blockImages?: boolean }} [options]
   * @returns {Promise<import('playwright').Page>}
   */
  async newPage(options = {}) {
    if (!this.context) throw new Error('Browser not launched. Call launch() first.');

    const page = await this.context.newPage();
    page.setDefaultTimeout(30000);

    // Block unnecessary resources for faster loading
    if (options.blockImages) {
      await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,ico,woff,woff2,ttf,eot}', (route) => route.abort());
    }

    return page;
  }

  /** Close the browser. */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }
}
