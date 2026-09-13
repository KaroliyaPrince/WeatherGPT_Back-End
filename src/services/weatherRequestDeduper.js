const weatherCache = require('./weatherCache');

/**
 * Weather Request Deduplicator / Coalescer
 * Prevents multiple concurrent requests for the exact same coordinates from firing
 * duplicate requests to the weather provider.
 */

class WeatherRequestDeduper {
  constructor() {
    this.inFlight = new Map(); // key -> Promise
  }

  /**
   * Executes or coalesces an async provider request.
   * If a request for identical normalized coordinates is already in-flight,
   * awaits the existing promise instead of dispatching a duplicate request.
   */
  async execute(lat, lon, asyncFetchFn) {
    const key = weatherCache.normalizeKey(lat, lon);
    if (!key) {
      return asyncFetchFn();
    }

    if (this.inFlight.has(key)) {
      console.log(`[Weather Dedup] Waiting for in-flight request ${key}`);
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        return await asyncFetchFn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Clears all in-flight promises (useful for tests)
   */
  clear() {
    this.inFlight.clear();
  }
}

const deduperInstance = new WeatherRequestDeduper();
module.exports = deduperInstance;