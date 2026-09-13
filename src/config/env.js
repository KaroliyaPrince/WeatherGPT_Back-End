/**
 * Environment Variable Validation & Configuration Loader
 * Ensures all configuration parameters have sensible defaults and validates required secrets safely.
 */

function getEnvConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';

  const port = Number(process.env.PORT) || 5000;

  // Google Maps & Routes API Key
  const googleMapsApiKey = (process.env.GOOGLE_MAPS_API_KEY &&
                            process.env.GOOGLE_MAPS_API_KEY.trim() !== '' &&
                            process.env.GOOGLE_MAPS_API_KEY !== 'YOUR_GOOGLE_MAPS_API_KEY')
                            ? process.env.GOOGLE_MAPS_API_KEY.trim()
                            : null;

  // Tomorrow.io Weather API Key
  const tomorrowApiKey = (process.env.TOMORROW_API_KEY &&
                          process.env.TOMORROW_API_KEY.trim() !== '' &&
                          process.env.TOMORROW_API_KEY !== 'YOUR_API_KEY')
                          ? process.env.TOMORROW_API_KEY.trim()
                          : null;

  // Route Sampling & Settlement Selection Configuration
  const routeSampleDistanceKm = Math.max(1, Number(process.env.ROUTE_SAMPLE_DISTANCE_KM) || 5);
  const routePlaceMaxDistanceKm = Math.max(0.5, Number(process.env.ROUTE_PLACE_MAX_DISTANCE_KM) || 2);
  const minPlaceSpacingKm = Math.max(1, Number(process.env.MIN_PLACE_SPACING_KM) || 10);
  const maxIntermediatePlaces = Math.max(1, Number(process.env.MAX_INTERMEDIATE_PLACES) || 10);

  // Traffic aware routing setting (default: true)
  const routeUseTraffic = process.env.ROUTE_USE_TRAFFIC !== 'false';

  // Weather Concurrency (default: 2)
  const weatherConcurrency = Math.max(1, Number(process.env.WEATHER_CONCURRENCY) || 2);

  // Rate Limiting & Cooldown Settings
  const tomorrowRateLimitPerHour = Math.max(1, Number(process.env.TOMORROW_RATE_LIMIT_PER_HOUR) || 20);
  const tomorrowRateLimitWindowMinutes = Math.max(1, Number(process.env.TOMORROW_RATE_LIMIT_WINDOW_MINUTES) || 60);
  const tomorrowApiTimeoutMs = Math.max(1000, Number(process.env.TOMORROW_API_TIMEOUT_MS) || 8000);

  // Cache TTL & Stale-While-Revalidate Settings
  const weatherCacheTtlSeconds = Math.max(10, Number(process.env.WEATHER_CACHE_TTL_SECONDS) || 600); // 10 mins
  const weatherStaleMaxAgeSeconds = Math.max(weatherCacheTtlSeconds, Number(process.env.WEATHER_STALE_MAX_AGE_SECONDS) || 3600); // 1 hour
  const ttlHistoricalWeatherMs = Math.max(60000, Number(process.env.TTL_HISTORICAL_WEATHER_MS) || 24 * 60 * 60 * 1000);

  return {
    nodeEnv,
    port,
    googleMapsApiKey,
    tomorrowApiKey,
    routeSampleDistanceKm,
    routePlaceMaxDistanceKm,
    minPlaceSpacingKm,
    maxIntermediatePlaces,
    routeUseTraffic,
    weatherConcurrency,
    tomorrowRateLimitPerHour,
    tomorrowRateLimitWindowMinutes,
    tomorrowApiTimeoutMs,
    weatherCacheTtlSeconds,
    weatherStaleMaxAgeSeconds,
    ttlHistoricalWeatherMs
  };
}

/**
 * Validates environment settings on application startup
 */
function validateEnv() {
  const config = getEnvConfig();

  console.log(`[Config] Initializing WeatherGPT Backend (${config.nodeEnv})`);
  console.log(`[Config] Google Maps Key Configured: ${config.googleMapsApiKey ? 'YES' : 'NO (Using OSRM + Public Geocoding)'}`);
  console.log(`[Config] Tomorrow.io Key Configured: ${config.tomorrowApiKey ? 'YES' : 'NO (Using Open-Meteo Fallback)'}`);
  console.log(`[Config] Traffic Routing Enabled: ${config.routeUseTraffic}`);
  console.log(`[Config] Route Sample Distance: ${config.routeSampleDistanceKm} km`);
  console.log(`[Config] Max Place Distance: ${config.routePlaceMaxDistanceKm} km`);
  console.log(`[Config] Min Place Spacing: ${config.minPlaceSpacingKm} km`);
  console.log(`[Config] Max Intermediate Places: ${config.maxIntermediatePlaces}`);

  return config;
}

module.exports = {
  getEnvConfig,
  validateEnv
};
