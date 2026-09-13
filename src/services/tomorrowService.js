const axios = require('axios');
const { mapWeatherCondition, normalizeHistoricalDailyItem } = require('../utils/weatherMapper');
const { geocodeLocation } = require('./googleRoutesService');
const cacheService = require('./cacheService');
const weatherCache = require('./weatherCache');
const weatherRequestDeduper = require('./weatherRequestDeduper');
const weatherRateLimiter = require('./weatherRateLimiter');
const { getEnvConfig } = require('../config/env');

const BASE_URL = 'https://api.tomorrow.io/v4/weather';
const TIMEOUT_MS = 8000;

/**
 * Retrieves Tomorrow.io API Key safely from environment
 */
function getApiKey() {
  const key = process.env.TOMORROW_API_KEY;
  if (!key || key.trim() === '' || key === 'YOUR_API_KEY') {
    return null;
  }
  return key.trim();
}

/**
 * Safely rounds numeric values to given precision or returns null
 */
function roundOrNull(val, precision = 1) {
  if (val === undefined || val === null || isNaN(val)) return null;
  const factor = Math.pow(10, precision);
  return Math.round(Number(val) * factor) / factor;
}

/**
 * Helper to parse location parameter into { lat, lon, name }
 */
async function parseLocationParam(locationParam) {
  if (!locationParam) return null;
  const str = String(locationParam).trim();

  // Coordinates string: "22.8004,70.8862"
  if (str.includes(',')) {
    const parts = str.split(',');
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lon)) {
      let resolvedName = null;
      try {
        const { reverseGeocodeLocation } = require('./googleRoutesService');
        const rev = await reverseGeocodeLocation(lat, lon);
        if (rev && rev.name) resolvedName = rev.name;
      } catch (e) {}
      return { lat, lon, name: resolvedName || `${lat.toFixed(2)},${lon.toFixed(2)}` };
    }
  }

  // Single numeric float string e.g. "22.4319"
  if (!isNaN(Number(str))) {
    const lat = parseFloat(str);
    const lon = 70.8862;
    let resolvedName = null;
    try {
      const { reverseGeocodeLocation } = require('./googleRoutesService');
      const rev = await reverseGeocodeLocation(lat, lon);
      if (rev && rev.name) resolvedName = rev.name;
    } catch (e) {}
    return { lat, lon, name: resolvedName || `${lat.toFixed(2)},${lon.toFixed(2)}` };
  }

  // City string: "morbi"
  const geo = await geocodeLocation(str);
  if (geo) {
    return { lat: geo.latitude, lon: geo.longitude, name: geo.name };
  }

  return null;
}

/**
 * Open-Meteo Fallback Weather Provider (Complete Realtime, Hourly, Daily)
 */
async function getWeatherOpenMeteoFull(lat, lon, placeName = '') {
  try {
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m',
        hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,surface_pressure,wind_speed_10m,uv_index,visibility',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant',
        timezone: 'auto'
      },
      timeout: 6000
    });

    const current = res.data?.current || {};
    const hourly = res.data?.hourly || {};
    const daily = res.data?.daily || {};

    const temp = roundOrNull(current.temperature_2m, 1) ?? 28;
    const feels = roundOrNull(current.apparent_temperature, 1) ?? temp;
    const humidity = roundOrNull(current.relative_humidity_2m, 0) ?? 60;
    const windMps = (current.wind_speed_10m || 10) / 3.6;
    const pressureMb = roundOrNull(current.surface_pressure, 0) ?? 1008;
    const uv = roundOrNull(hourly.uv_index?.[0], 0) ?? 5;
    const visMeters = hourly.visibility?.[0] ? hourly.visibility[0] : 10000;
    const precipMm = roundOrNull(current.precipitation, 1) ?? 0;
    const rainProb = roundOrNull(hourly.precipitation_probability?.[0], 0) ?? 0;
    const weatherCode = current.weather_code || hourly.weather_code?.[0] || 1000;

    // Convert hourly arrays to Tomorrow.io interval structure
    const hourlyIntervals = [];
    if (Array.isArray(hourly.time)) {
      for (let i = 0; i < Math.min(24, hourly.time.length); i++) {
        hourlyIntervals.push({
          time: hourly.time[i],
          values: {
            temperature: hourly.temperature_2m?.[i],
            temperatureApparent: hourly.temperature_2m?.[i],
            humidity: hourly.relative_humidity_2m?.[i],
            windSpeed: (hourly.wind_speed_10m?.[i] || 0) / 3.6,
            windDirection: 180,
            pressureSurfaceLevel: hourly.surface_pressure?.[i],
            visibility: (hourly.visibility?.[i] || 10000) / 1000,
            cloudCover: 20,
            uvIndex: hourly.uv_index?.[i] || 0,
            precipitationProbability: hourly.precipitation_probability?.[i] || 0,
            precipitationIntensity: hourly.precipitation?.[i] || 0,
            rainAccumulation: hourly.precipitation?.[i] || 0,
            weatherCode: hourly.weather_code?.[i] || 1000
          }
        });
      }
    }

    // Convert daily arrays to Tomorrow.io daily structure
    const dailyIntervals = [];
    if (Array.isArray(daily.time)) {
      for (let i = 0; i < daily.time.length; i++) {
        dailyIntervals.push({
          time: daily.time[i],
          values: {
            temperatureMax: daily.temperature_2m_max?.[i],
            temperatureMin: daily.temperature_2m_min?.[i],
            temperatureAvg: roundOrNull((daily.temperature_2m_max?.[i] + daily.temperature_2m_min?.[i]) / 2, 1),
            precipitationProbabilityMax: daily.precipitation_probability_max?.[i] || 0,
            rainAccumulationSum: daily.precipitation_sum?.[i] || 0,
            windSpeedAvg: (daily.wind_speed_10m_max?.[i] || 0) / 3.6,
            windDirectionAvg: daily.wind_direction_10m_dominant?.[i] || 180,
            sunriseTime: daily.sunrise?.[i],
            sunsetTime: daily.sunset?.[i],
            weatherCodeMax: daily.weather_code?.[i] || 1000
          }
        });
      }
    }

    let finalName = placeName;
    if (!finalName || !isNaN(Number(finalName)) || finalName.includes(',')) {
      try {
        const { reverseGeocodeLocation } = require('./googleRoutesService');
        const rev = await reverseGeocodeLocation(lat, lon);
        if (rev && rev.name) finalName = rev.name;
      } catch (e) {}
    }

    return {
      location: {
        name: finalName || `${lat}, ${lon}`,
        lat: lat,
        lon: lon
      },
      data: {
        time: current.time || new Date().toISOString(),
        values: {
          temperature: temp,
          temperatureApparent: feels,
          humidity: humidity,
          windSpeed: windMps,
          windDirection: current.wind_direction_10m || 180,
          pressureSurfaceLevel: pressureMb,
          visibility: visMeters / 1000,
          cloudCover: 20,
          uvIndex: uv,
          precipitationProbability: rainProb,
          precipitationIntensity: precipMm,
          rainAccumulation: precipMm,
          weatherCode: weatherCode
        }
      },
      timelines: {
        hourly: hourlyIntervals,
        daily: dailyIntervals
      },
      alerts: []
    };
  } catch (err) {
    console.error(`[Open-Meteo Full Error] (${lat}, ${lon}):`, err.message);
    return null;
  }
}

/**
 * Dispatch network call to Tomorrow.io /realtime
 */
async function dispatchTomorrowRealtimeCall(lat, lon) {
  const apiKey = getApiKey();
  const config = getEnvConfig();
  const locationQuery = `${lat.toFixed(4)},${lon.toFixed(4)}`;

  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  console.log(`[Tomorrow Provider] Request started ${locationQuery}`);

  try {
    const response = await axios.get(`${BASE_URL}/realtime`, {
      params: {
        location: locationQuery,
        units: 'metric',
        apikey: apiKey
      },
      timeout: config.tomorrowApiTimeoutMs || TIMEOUT_MS
    });

    const values = response.data?.data?.values;
    if (!values) {
      throw new Error('MALFORMED_PROVIDER_RESPONSE');
    }

    console.log(`[Tomorrow Provider] Request completed ${locationQuery}`);
    const mappedCond = mapWeatherCondition(values.weatherCode);
    const temp = roundOrNull(values.temperature, 1);
    const feels = roundOrNull(values.temperatureApparent, 1) ?? temp;
    const humidity = roundOrNull(values.humidity, 0);
    const windKph = values.windSpeed !== undefined && values.windSpeed !== null ? roundOrNull(values.windSpeed * 3.6, 1) : null;
    const pressureMb = roundOrNull(values.pressureSurfaceLevel, 0);
    const uv = roundOrNull(values.uvIndex, 0);
    const visKm = roundOrNull(values.visibility, 1);
    const precipMm = roundOrNull(values.precipitationIntensity, 1) ?? 0;
    const rainProb = roundOrNull(values.precipitationProbability, 0) ?? 0;

    return {
      temp_c: temp,
      temperature_c: temp,
      condition: {
        text: mappedCond.text,
        icon: mappedCond.icon,
        code: mappedCond.code
      },
      weather_code: mappedCond.code,
      wind_kph: windKph,
      wind_speed_kph: windKph,
      wind_direction: roundOrNull(values.windDirection, 0),
      humidity: humidity,
      feelslike_c: feels,
      uv: uv,
      uv_index: uv,
      visibility_km: visKm,
      pressure_mb: pressureMb,
      precip_mm: precipMm,
      precipitation_mm: precipMm,
      rain_probability: rainProb
    };
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn(`[Tomorrow Provider] 429 for ${locationQuery}`);
      const retryAfterHeader = err.response.headers?.['retry-after'];
      const retryAfterSec = Number(retryAfterHeader) || 60;
      weatherRateLimiter.trigger429Cooldown(retryAfterSec);
    } else {
      console.error(`[Tomorrow Provider] Request failed for ${locationQuery}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Centralized Provider Weather Fetching Engine
 */
async function fetchProviderWeather(latitude, longitude, priority = 'HIGH') {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (isNaN(lat) || isNaN(lon)) {
    console.error(`[Tomorrow Weather Error] Invalid coordinates: (${latitude}, ${longitude})`);
    return null;
  }

  const config = getEnvConfig();
  const cacheKeyStr = `${lat.toFixed(4)},${lon.toFixed(4)}`;

  // STEP 1: Cache Check
  const cached = weatherCache.get(lat, lon);
  if (cached) {
    if (cached.isFresh) {
      console.log(`[Weather Cache] HIT ${cacheKeyStr}`);
      return cached.data;
    }

    if (cached.isStale) {
      console.log(`[Weather Fallback] Using stale cache ${cacheKeyStr}`);
      // Trigger background revalidation (LOW priority) if rate limiter allows
      if (!weatherRateLimiter.isCoolingDown() && weatherRateLimiter.hasQuota()) {
        weatherRequestDeduper.execute(lat, lon, () => 
          weatherRateLimiter.schedule(() => dispatchTomorrowRealtimeCall(lat, lon), 'LOW')
            .then(freshWeather => {
              if (freshWeather) {
                weatherCache.set(lat, lon, freshWeather, config.weatherCacheTtlSeconds, config.weatherStaleMaxAgeSeconds);
                console.log(`[Weather Cache] WRITE (Background) ${cacheKeyStr}`);
              }
            })
            .catch(err => console.warn(`[Weather Background Revalidate] Skipped: ${err.message}`))
        ).catch(() => {});
      }
      return { ...cached.data, is_stale: true };
    }
  }

  console.log(`[Weather Cache] MISS ${cacheKeyStr}`);

  // Check rate-limit cooldown
  if (weatherRateLimiter.isCoolingDown()) {
    console.warn(`[Tomorrow Provider] Cooldown active. Checking stale fallback for ${cacheKeyStr}`);
    if (cached && cached.data) {
      return { ...cached.data, is_stale: true };
    }
    return null;
  }

  // STEP 2: Request Deduplication & Rate Limited Execution
  return weatherRequestDeduper.execute(lat, lon, async () => {
    // Re-check fresh cache inside deduper task in case a coalesced request completed
    const rechecked = weatherCache.get(lat, lon);
    if (rechecked && rechecked.isFresh) {
      console.log(`[Weather Dedup] Coalesced HIT ${cacheKeyStr}`);
      return rechecked.data;
    }

    try {
      const weather = await weatherRateLimiter.schedule(
        () => dispatchTomorrowRealtimeCall(lat, lon),
        priority
      );

      if (weather) {
        weatherCache.set(lat, lon, weather, config.weatherCacheTtlSeconds, config.weatherStaleMaxAgeSeconds);
        console.log(`[Weather Cache] WRITE ${cacheKeyStr}`);
        return weather;
      }
    } catch (err) {
      // If HTTP 429 error triggered or provider failed, fallback to stale cache if available
      if (cached && cached.data) {
        console.log(`[Weather Fallback] Provider failed. Returning stale cache for ${cacheKeyStr}`);
        return { ...cached.data, is_stale: true };
      }
    }

    return null;
  });
}

/**
 * Dedicated function to fetch weather by coordinates from Tomorrow.io (with Open-Meteo fallback)
 */
async function getWeatherByCoordinates(latitude, longitude, placeName = '', priority = 'HIGH') {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (isNaN(lat) || isNaN(lon)) {
    console.error(`[Tomorrow Weather Error] Invalid coordinates: (${latitude}, ${longitude})`);
    return null;
  }

  // Attempt Tomorrow.io via centralized provider path
  const weather = await fetchProviderWeather(lat, lon, priority);
  if (weather && weather.temperature_c !== null) {
    return weather;
  }

  // Fallback to Open-Meteo
  const fallback = await getWeatherOpenMeteoFull(lat, lon, placeName);
  if (fallback?.data?.values) {
    const vals = fallback.data.values;
    const mappedCond = mapWeatherCondition(vals.weatherCode);
    const temp = vals.temperature;
    return {
      temp_c: temp,
      temperature_c: temp,
      condition: {
        text: mappedCond.text,
        icon: mappedCond.icon,
        code: mappedCond.code
      },
      weather_code: mappedCond.code,
      wind_kph: roundOrNull(vals.windSpeed * 3.6, 1),
      wind_speed_kph: roundOrNull(vals.windSpeed * 3.6, 1),
      wind_direction: vals.windDirection,
      humidity: vals.humidity,
      feelslike_c: vals.temperatureApparent,
      uv: vals.uvIndex,
      uv_index: vals.uvIndex,
      visibility_km: vals.visibility,
      pressure_mb: vals.pressureSurfaceLevel,
      precip_mm: vals.precipitationIntensity,
      precipitation_mm: vals.precipitationIntensity,
      rain_probability: vals.precipitationProbability
    };
  }

  return null;
}

/**
 * Fetches real-time weather structure (Tomorrow.io with Open-Meteo fallback)
 */
async function fetchRealtime(locationParam) {
  const loc = await parseLocationParam(locationParam);
  if (!loc) return null;

  const apiKey = getApiKey();
  if (apiKey) {
    try {
      const response = await axios.get(`${BASE_URL}/realtime`, {
        params: {
          location: `${loc.lat},${loc.lon}`,
          units: 'metric',
          apikey: apiKey
        },
        timeout: TIMEOUT_MS
      });

      if (response.data?.data?.values) {
        return {
          location: { name: loc.name, lat: loc.lat, lon: loc.lon },
          data: response.data.data
        };
      }
    } catch (err) {
      console.warn(`[Tomorrow Weather] Realtime API failed for "${loc.name}": ${err.message}. Using fallback...`);
    }
  }

  return getWeatherOpenMeteoFull(loc.lat, loc.lon, loc.name);
}

/**
 * Fetches forecast structure (Tomorrow.io with Open-Meteo fallback)
 */
async function fetchForecast(locationParam) {
  const loc = await parseLocationParam(locationParam);
  if (!loc) return null;

  const apiKey = getApiKey();
  if (apiKey) {
    try {
      const response = await axios.get(`${BASE_URL}/forecast`, {
        params: {
          location: `${loc.lat},${loc.lon}`,
          timesteps: '1h,1d',
          units: 'metric',
          apikey: apiKey
        },
        timeout: TIMEOUT_MS
      });

      if (response.data?.timelines) {
        return {
          location: { name: loc.name, lat: loc.lat, lon: loc.lon },
          timelines: response.data.timelines,
          alerts: response.data.alerts || []
        };
      }
    } catch (err) {
      console.warn(`[Tomorrow Weather] Forecast API failed for "${loc.name}": ${err.message}. Using fallback...`);
    }
  }

  return getWeatherOpenMeteoFull(loc.lat, loc.lon, loc.name);
}

/**
 * Computes past 7 completed calendar dates in specified timezone
 */
function getPast7CompletedDays(timeZone = 'Asia/Kolkata') {
  const now = new Date();
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (e) {
    timeZone = 'Asia/Kolkata';
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const localTodayStr = formatter.format(now); // "YYYY-MM-DD"
  const [year, month, day] = localTodayStr.split('-').map(Number);
  const todayDateObj = new Date(Date.UTC(year, month - 1, day));

  const dates = [];
  for (let i = 7; i >= 1; i--) {
    const d = new Date(todayDateObj);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().substring(0, 10));
  }

  return {
    dates,
    fromDate: dates[0],
    toDate: dates[dates.length - 1],
    timeZone
  };
}

/**
 * Fetches historical data from Open-Meteo Archive API (Real Observational Historical Data)
 */
async function fetchHistoryFromOpenMeteoArchive(lat, lon, fromDate, toDate, timeZone = 'Asia/Kolkata') {
  try {
    const res = await axios.get('https://archive-api.open-meteo.com/v1/archive', {
      params: {
        latitude: lat,
        longitude: lon,
        start_date: fromDate,
        end_date: toDate,
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,relative_humidity_2m_max,relative_humidity_2m_min,relative_humidity_2m_mean,wind_speed_10m_max,wind_speed_10m_mean,precipitation_sum,surface_pressure_mean,cloud_cover_mean',
        timezone: timeZone
      },
      timeout: TIMEOUT_MS
    });

    const daily = res.data?.daily;
    if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) {
      return null;
    }

    const items = [];
    for (let i = 0; i < daily.time.length; i++) {
      items.push({
        date: daily.time[i],
        values: {
          temperature_2m_max: daily.temperature_2m_max?.[i],
          temperature_2m_min: daily.temperature_2m_min?.[i],
          temperature_2m_mean: daily.temperature_2m_mean?.[i],
          relative_humidity_2m_max: daily.relative_humidity_2m_max?.[i],
          relative_humidity_2m_min: daily.relative_humidity_2m_min?.[i],
          relative_humidity_2m_mean: daily.relative_humidity_2m_mean?.[i],
          wind_speed_10m_max: daily.wind_speed_10m_max?.[i],
          wind_speed_10m_mean: daily.wind_speed_10m_mean?.[i],
          precipitation_sum: daily.precipitation_sum?.[i],
          surface_pressure_mean: daily.surface_pressure_mean?.[i],
          cloud_cover_mean: daily.cloud_cover_mean?.[i],
          weather_code: daily.weather_code?.[i]
        }
      });
    }

    return items;
  } catch (err) {
    console.error(`[Open-Meteo Archive Error] (${lat}, ${lon}):`, err.message);
    return null;
  }
}

/**
 * Fetches last 7 completed days of historical weather data
 */
async function fetchHistory(locationParam, requestedTimeZone = 'Asia/Kolkata') {
  const loc = await parseLocationParam(locationParam);
  if (!loc) return null;

  const timeZone = requestedTimeZone || 'Asia/Kolkata';
  const period = getPast7CompletedDays(timeZone);

  // Check historical cache first
  const cachedHistory = cacheService.getHistoricalWeather(loc.lat, loc.lon, period.fromDate, period.toDate);
  if (cachedHistory) {
    return cachedHistory;
  }

  let historyItems = null;
  let source = 'Tomorrow.io';

  const apiKey = getApiKey();
  if (apiKey) {
    try {
      // Attempt Tomorrow.io V4 /weather/history/recent API
      const response = await axios.get(`${BASE_URL}/history/recent`, {
        params: {
          location: `${loc.lat},${loc.lon}`,
          timesteps: '1d',
          startTime: `${period.fromDate}T00:00:00Z`,
          endTime: `${period.toDate}T23:59:59Z`,
          units: 'metric',
          apikey: apiKey
        },
        timeout: TIMEOUT_MS
      });

      const dailyTimelines = response.data?.timelines?.daily;
      if (Array.isArray(dailyTimelines) && dailyTimelines.length >= 7) {
        historyItems = dailyTimelines;
      }
    } catch (err) {
      console.warn(`[Tomorrow Weather] Historical API failed for "${loc.name}": ${err.message}. Using Open-Meteo Archive fallback...`);
    }
  }

  // Fallback to Open-Meteo Archive if Tomorrow.io didn't provide 7 full days
  if (!historyItems) {
    const fallbackItems = await fetchHistoryFromOpenMeteoArchive(loc.lat, loc.lon, period.fromDate, period.toDate, timeZone);
    if (fallbackItems && fallbackItems.length > 0) {
      historyItems = fallbackItems;
      source = 'Open-Meteo Archive Fallback';
    }
  }

  if (!historyItems || historyItems.length === 0) {
    return null;
  }

  const normalizedHistory = historyItems
    .map(normalizeHistoricalDailyItem)
    .filter(Boolean);

  const result = {
    source,
    location: {
      name: loc.name,
      latitude: loc.lat,
      longitude: loc.lon
    },
    period: {
      days: normalizedHistory.length,
      from: period.fromDate,
      to: period.toDate,
      timezone: timeZone
    },
    history: normalizedHistory
  };

  // Cache the resulting historical record
  cacheService.setHistoricalWeather(loc.lat, loc.lon, period.fromDate, period.toDate, result);

  return result;
}

module.exports = {
  parseLocationParam,
  getWeatherByCoordinates,
  fetchRealtime,
  fetchForecast,
  fetchHistory,
  fetchProviderWeather
};
