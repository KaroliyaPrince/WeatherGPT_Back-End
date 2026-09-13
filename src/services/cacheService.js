/**
 * Modular Cache Service Layer
 * Abstracted in-memory cache with TTL support and deterministic key generation.
 */

class CacheService {
  constructor() {
    this.geocodeCache    = new Map(); // query -> { data, timestamp }
    this.routeCache      = new Map(); // source-dest -> { data, timestamp }
    this.weatherCache    = new Map(); // canonicalKey-hour -> { data, timestamp }
    this.historicalCache = new Map(); // weather-history:lat:lon:from:to -> { data, timestamp }

    this.TTL_GEOCODE_MS            = 60 * 60 * 1000; // 1 hour
    this.TTL_ROUTE_MS              = 15 * 60 * 1000; // 15 minutes
    this.TTL_WEATHER_MS            = 10 * 60 * 1000; // 10 minutes
    this.TTL_HISTORICAL_WEATHER_MS = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Geocode Cache
   */
  getGeocode(query) {
    if (!query) return null;
    const key = query.toLowerCase().trim();
    if (this.geocodeCache.has(key)) {
      const cached = this.geocodeCache.get(key);
      if (Date.now() - cached.timestamp < this.TTL_GEOCODE_MS) {
        return cached.data;
      }
      this.geocodeCache.delete(key);
    }
    return null;
  }

  setGeocode(query, data) {
    if (!query || !data) return;
    const key = query.toLowerCase().trim();
    this.geocodeCache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Route Cache
   */
  getRoute(sourceName, destName, trafficSetting) {
    if (!sourceName || !destName) return null;
    const key = `${sourceName.toLowerCase().trim()}-${destName.toLowerCase().trim()}-traffic:${trafficSetting}`;
    if (this.routeCache.has(key)) {
      const cached = this.routeCache.get(key);
      if (Date.now() - cached.timestamp < this.TTL_ROUTE_MS) {
        return cached.data;
      }
      this.routeCache.delete(key);
    }
    return null;
  }

  setRoute(sourceName, destName, trafficSetting, data) {
    if (!sourceName || !destName || !data) return;
    const key = `${sourceName.toLowerCase().trim()}-${destName.toLowerCase().trim()}-traffic:${trafficSetting}`;
    this.routeCache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Weather Cache
   */
  getWeather(canonicalId, lat, lon, arrivalIsoString) {
    const arrivalHourStr = new Date(arrivalIsoString).toISOString().substring(0, 13);
    const key = canonicalId
      ? `${canonicalId}-${arrivalHourStr}`
      : `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}-${arrivalHourStr}`;

    if (this.weatherCache.has(key)) {
      const cached = this.weatherCache.get(key);
      if (Date.now() - cached.timestamp < this.TTL_WEATHER_MS) {
        return cached.data;
      }
      this.weatherCache.delete(key);
    }
    return null;
  }

  setWeather(canonicalId, lat, lon, arrivalIsoString, data) {
    if (!data) return;
    const arrivalHourStr = new Date(arrivalIsoString).toISOString().substring(0, 13);
    const key = canonicalId
      ? `${canonicalId}-${arrivalHourStr}`
      : `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}-${arrivalHourStr}`;

    this.weatherCache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Historical Weather Cache
   */
  getHistoricalWeather(lat, lon, fromDate, toDate) {
    if (lat === undefined || lon === undefined || !fromDate || !toDate) return null;
    const key = `weather-history:${Number(lat).toFixed(4)}:${Number(lon).toFixed(4)}:${fromDate}:${toDate}`;
    if (this.historicalCache.has(key)) {
      const cached = this.historicalCache.get(key);
      if (Date.now() - cached.timestamp < this.TTL_HISTORICAL_WEATHER_MS) {
        return cached.data;
      }
      this.historicalCache.delete(key);
    }
    return null;
  }

  setHistoricalWeather(lat, lon, fromDate, toDate, data) {
    if (lat === undefined || lon === undefined || !fromDate || !toDate || !data) return;
    const key = `weather-history:${Number(lat).toFixed(4)}:${Number(lon).toFixed(4)}:${fromDate}:${toDate}`;
    this.historicalCache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Clears all caches (useful for testing)
   */
  clearAll() {
    this.geocodeCache.clear();
    this.routeCache.clear();
    this.weatherCache.clear();
    this.historicalCache.clear();
    console.log('[CacheService] All caches cleared.');
  }
}

const cacheServiceInstance = new CacheService();

module.exports = cacheServiceInstance;
