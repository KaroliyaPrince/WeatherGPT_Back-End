/**
 * Abstracted Weather Cache Layer
 * Normalized coordinate-based caching with Fresh TTL and Stale-While-Revalidate support.
 * Designed to be backed by in-memory Map or easily swapped to Redis driver.
 */

class WeatherCache {
  constructor() {
    this.cache = new Map(); // key -> cacheEntry
  }

  /**
   * Normalizes latitude and longitude coordinates into a standard cache key.
   * e.g. (22.800412, 70.886231) -> "weather:22.8004:70.8862"
   */
  normalizeKey(lat, lon) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (isNaN(latitude) || isNaN(longitude)) {
      return null;
    }
    return `weather:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
  }

  /**
   * Retrieves weather entry by coordinates.
   * Returns { data, isFresh, isStale, isExpired } or null if not found.
   */
  get(lat, lon) {
    const key = this.normalizeKey(lat, lon);
    if (!key || !this.cache.has(key)) {
      return null;
    }

    const entry = this.cache.get(key);
    const now = Date.now();

    const isFresh = now <= entry.freshUntil;
    const isStale = now > entry.freshUntil && now <= entry.staleUntil;
    const isExpired = now > entry.staleUntil;

    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return {
      data: entry.weather,
      isFresh,
      isStale,
      isExpired: false,
      fetchedAt: entry.fetchedAt
    };
  }

  /**
   * Sets weather entry for given coordinates with fresh TTL and stale max age.
   */
  set(lat, lon, weather, ttlSeconds = 600, staleMaxAgeSeconds = 3600) {
    const key = this.normalizeKey(lat, lon);
    if (!key || !weather) return;

    const now = Date.now();
    const freshMs = Math.max(10, Number(ttlSeconds) || 600) * 1000;
    const staleMs = Math.max(freshMs, Number(staleMaxAgeSeconds) || 3600) * 1000;

    const entry = {
      latitude: Number(Number(lat).toFixed(4)),
      longitude: Number(Number(lon).toFixed(4)),
      weather,
      fetchedAt: now,
      freshUntil: now + freshMs,
      staleUntil: now + staleMs
    };

    this.cache.set(key, entry);
  }

  /**
   * Checks if cache contains a non-expired entry for coordinates.
   */
  has(lat, lon) {
    const res = this.get(lat, lon);
    return res !== null && !res.isExpired;
  }

  /**
   * Deletes a cache entry.
   */
  delete(lat, lon) {
    const key = this.normalizeKey(lat, lon);
    if (key) {
      this.cache.delete(key);
    }
  }

  /**
   * Clears all weather cache entries.
   */
  clear() {
    this.cache.clear();
  }
}

const weatherCacheInstance = new WeatherCache();
module.exports = weatherCacheInstance;