import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistent crawl state for resumability.
 */
export class CrawlState {
  /**
   * @param {string} filePath
   * @param {object} data
   */
  constructor(filePath, data) {
    this.filePath = filePath;
    this.data = data;
  }

  /**
   * Load state from file, or create a new one.
   * @param {string} filePath
   * @param {object} [config]
   * @returns {CrawlState}
   */
  static load(filePath, config = {}) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      return new CrawlState(filePath, data);
    }
    const data = {
      version: 1,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      config,
      stats: {
        discovered: 0,
        crawled: 0,
        failed: 0,
        skipped: 0,
      },
      urls: {},
    };
    return new CrawlState(filePath, data);
  }

  /**
   * Atomic save: write to temp file, then rename.
   */
  save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.data.lastUpdatedAt = new Date().toISOString();
    this._updateStats();
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  /** Recalculate stats from url statuses. */
  _updateStats() {
    const stats = { discovered: 0, crawled: 0, failed: 0, skipped: 0 };
    for (const entry of Object.values(this.data.urls)) {
      stats.discovered += 1;
      if (entry.status === 'crawled') stats.crawled += 1;
      else if (entry.status === 'failed') stats.failed += 1;
      else if (entry.status === 'skipped') stats.skipped += 1;
    }
    this.data.stats = stats;
  }

  /**
   * Add a URL with pending status. No-op if already exists.
   * @param {string} url
   */
  addUrl(url) {
    if (!this.data.urls[url]) {
      this.data.urls[url] = {
        status: 'pending',
        error: null,
        crawledAt: null,
      };
    }
  }

  /**
   * Bulk add URLs.
   * @param {string[]} urls
   */
  addUrls(urls) {
    for (const url of urls) {
      this.addUrl(url);
    }
  }

  /**
   * Mark a URL as crawled.
   * @param {string} url
   */
  markCrawled(url) {
    if (this.data.urls[url]) {
      this.data.urls[url].status = 'crawled';
      this.data.urls[url].crawledAt = new Date().toISOString();
    }
  }

  /**
   * Mark a URL as failed.
   * @param {string} url
   * @param {string} error
   */
  markFailed(url, error) {
    if (this.data.urls[url]) {
      this.data.urls[url].status = 'failed';
      this.data.urls[url].error = error;
    }
  }

  /**
   * Mark a URL as skipped.
   * @param {string} url
   * @param {string} reason
   */
  markSkipped(url, reason) {
    if (this.data.urls[url]) {
      this.data.urls[url].status = 'skipped';
      this.data.urls[url].error = reason;
    }
  }

  /**
   * Get all pending URLs.
   * @returns {string[]}
   */
  getPendingUrls() {
    return Object.entries(this.data.urls)
      .filter(([, entry]) => entry.status === 'pending')
      .map(([url]) => url);
  }

  /** @returns {{ discovered: number, crawled: number, failed: number, skipped: number }} */
  getStats() {
    this._updateStats();
    return { ...this.data.stats };
  }

  /** @returns {boolean} */
  isComplete() {
    return this.getPendingUrls().length === 0;
  }
}
