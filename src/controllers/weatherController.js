const { mapWeatherCondition } = require('../utils/weatherMapper');
const { fetchRealtime, fetchForecast, fetchHistory } = require('../services/tomorrowService');
const { geocodeLocation, reverseGeocodeLocation, searchCities } = require('../services/googleRoutesService');

/**
 * Validates and extracts location parameters from request query
 */
async function extractLocationParam(query) {
  const locationInput = query.location || query.city;
  const { lat, lon } = query;

  // City / Location string based lookup
  if (locationInput && typeof locationInput === 'string' && locationInput.trim() !== '') {
    const rawStr = locationInput.trim();

    // Check if location string is formatted as "lat,lon"
    if (rawStr.includes(',')) {
      const parts = rawStr.split(',');
      const latitude = Number(parts[0]);
      const longitude = Number(parts[1]);
      if (!isNaN(latitude) && !isNaN(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
        let city = null;
        try {
          const rev = await reverseGeocodeLocation(latitude, longitude);
          if (rev && rev.name) city = rev.name;
        } catch (e) {}

        return {
          locationQuery: `${latitude},${longitude}`,
          city: city,
          lat: latitude,
          lon: longitude,
          isValid: true
        };
      }
    }

    // Check if rawStr is a single float coordinate number like "22.4319"
    if (!isNaN(Number(rawStr))) {
      const latitude = Number(rawStr);
      const longitude = lon !== undefined ? Number(lon) : 70.8862;
      if (latitude >= -90 && latitude <= 90) {
        let city = null;
        try {
          const rev = await reverseGeocodeLocation(latitude, longitude);
          if (rev && rev.name) city = rev.name;
        } catch (e) {}

        return {
          locationQuery: `${latitude},${longitude}`,
          city: city || `${latitude.toFixed(2)},${longitude.toFixed(2)}`,
          lat: latitude,
          lon: longitude,
          isValid: true
        };
      }
    }

    // Resolve city name via geocodeLocation (which checks canonical database first)
    const geo = await geocodeLocation(rawStr);
    if (geo) {
      return {
        locationQuery: `${geo.latitude},${geo.longitude}`,
        city: geo.name,
        lat: geo.latitude,
        lon: geo.longitude,
        isValid: true
      };
    }

    return {
      isValid: false,
      statusCode: 404,
      error: 'Unable to resolve location'
    };
  }

  // Coordinates based lookup
  if (lat !== undefined && lon !== undefined && lat !== '' && lon !== '') {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!isNaN(latitude) && !isNaN(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
      let city = null;
      try {
        const rev = await reverseGeocodeLocation(latitude, longitude);
        if (rev && rev.name) city = rev.name;
      } catch (e) {}

      return {
        locationQuery: `${latitude},${longitude}`,
        city: city,
        lat: latitude,
        lon: longitude,
        isValid: true
      };
    }

    return {
      isValid: false,
      statusCode: 400,
      error: 'Invalid latitude or longitude parameters'
    };
  }

  return {
    isValid: false,
    statusCode: 400,
    error: 'Location is required'
  };
}

/**
 * Formats location metadata cleanly
 */
function normalizeLocation(rawLocation, requestedCity, requestedLat, requestedLon) {
  let name = requestedCity || (rawLocation && rawLocation.name ? rawLocation.name.split(',')[0].trim() : 'Unknown Location');

  // If name is still a coordinate string like "22.4319" or "22.43,70.89", sanitize
  if (name && (name.includes(',') || !isNaN(Number(name)))) {
    if (requestedCity && isNaN(Number(requestedCity)) && !requestedCity.includes(',')) {
      name = requestedCity;
    } else if (rawLocation && rawLocation.name && isNaN(Number(rawLocation.name)) && !rawLocation.name.includes(',')) {
      name = rawLocation.name.split(',')[0].trim();
    }
  }

  let latitude = rawLocation && (rawLocation.lat !== undefined || rawLocation.latitude !== undefined) 
    ? Number(rawLocation.lat ?? rawLocation.latitude) 
    : (requestedLat !== null ? Number(requestedLat) : null);
  let longitude = rawLocation && (rawLocation.lon !== undefined || rawLocation.longitude !== undefined) 
    ? Number(rawLocation.lon ?? rawLocation.longitude) 
    : (requestedLon !== null ? Number(requestedLon) : null);

  return {
    name,
    latitude,
    longitude
  };
}

/**
 * Helper to safely round numeric values or return null if undefined/null
 */
function roundOrNull(val, precision = 1) {
  if (val === undefined || val === null || isNaN(val)) return null;
  const factor = Math.pow(10, precision);
  return Math.round(Number(val) * factor) / factor;
}

/**
 * Normalizes current weather values (from Tomorrow.io or Open-Meteo)
 */
function normalizeCurrent(values = {}) {
  const windKph = values.windSpeed !== undefined && values.windSpeed !== null 
    ? roundOrNull(values.windSpeed * 3.6, 1) 
    : (values.wind_speed_kph !== undefined ? roundOrNull(values.wind_speed_kph, 1) : null);

  const windGustKph = values.windGust !== undefined && values.windGust !== null 
    ? roundOrNull(values.windGust * 3.6, 1) 
    : null;

  const temp = roundOrNull(values.temperature ?? values.temperature_c ?? values.temp_c, 1);
  const feels = roundOrNull(values.temperatureApparent ?? values.feels_like_c ?? values.feelslike_c, 1) ?? temp;
  const weatherCode = values.weatherCode ?? values.weather_code ?? 1000;

  return {
    temperature_c: temp,
    feels_like_c: feels,
    humidity: roundOrNull(values.humidity, 0),
    wind_kph: windKph,
    wind_direction: roundOrNull(values.windDirection ?? values.wind_direction, 0),
    wind_gust_kph: windGustKph,
    pressure_mb: values.pressureSurfaceLevel !== undefined && values.pressureSurfaceLevel !== null 
      ? roundOrNull(values.pressureSurfaceLevel, 0) 
      : (values.pressure_mb !== undefined ? roundOrNull(values.pressure_mb, 0) : null),
    visibility_km: roundOrNull(values.visibility ?? values.visibility_km, 1),
    cloud_cover: roundOrNull(values.cloudCover ?? values.cloud_cover, 0),
    uv_index: roundOrNull(values.uvIndex ?? values.uv_index ?? values.uv, 0),
    precipitation_probability: roundOrNull(values.precipitationProbability ?? values.rain_probability, 0),
    precipitation_intensity: values.precipitationIntensity !== undefined && values.precipitationIntensity !== null 
      ? roundOrNull(values.precipitationIntensity, 1) 
      : (values.precip_mm !== undefined ? roundOrNull(values.precip_mm, 1) : 0),
    rain_accumulation_mm: values.rainAccumulation !== undefined && values.rainAccumulation !== null 
      ? roundOrNull(values.rainAccumulation, 1) 
      : 0,
    condition: mapWeatherCondition(weatherCode)
  };
}

/**
 * Normalizes hourly forecast timeline (~24 hours)
 */
function normalizeHourly(hourlyArray = []) {
  if (!Array.isArray(hourlyArray)) return [];
  return hourlyArray.slice(0, 24).map(item => {
    const vals = item.values || item;
    const windKph = vals.windSpeed !== undefined && vals.windSpeed !== null 
      ? roundOrNull(vals.windSpeed * 3.6, 1) 
      : (vals.wind_kph !== undefined ? roundOrNull(vals.wind_kph, 1) : null);

    return {
      time: item.time || null,
      temperature_c: roundOrNull(vals.temperature ?? vals.temperature_c, 1),
      feels_like_c: roundOrNull(vals.temperatureApparent ?? vals.feels_like_c, 1),
      humidity: roundOrNull(vals.humidity, 0),
      wind_kph: windKph,
      wind_direction: roundOrNull(vals.windDirection ?? vals.wind_direction, 0),
      pressure_mb: roundOrNull(vals.pressureSurfaceLevel ?? vals.pressure_mb, 0),
      visibility_km: roundOrNull(vals.visibility ?? vals.visibility_km, 1),
      cloud_cover: roundOrNull(vals.cloudCover ?? vals.cloud_cover, 0),
      uv_index: roundOrNull(vals.uvIndex ?? vals.uv_index, 0),
      precipitation_probability: roundOrNull(vals.precipitationProbability ?? vals.precipitation_probability, 0),
      precipitation_intensity: roundOrNull(vals.precipitationIntensity ?? vals.precipitation, 1),
      condition: mapWeatherCondition(vals.weatherCode ?? vals.weather_code)
    };
  });
}

/**
 * Normalizes daily forecast timeline
 */
function normalizeDaily(dailyArray = []) {
  if (!Array.isArray(dailyArray)) return [];
  return dailyArray.map(item => {
    const vals = item.values || item;
    const isoDate = item.time ? item.time.split('T')[0] : (item.date || null);

    const windKph = vals.windSpeedAvg !== undefined && vals.windSpeedAvg !== null 
      ? roundOrNull(vals.windSpeedAvg * 3.6, 1) 
      : (vals.windSpeed !== undefined && vals.windSpeed !== null ? roundOrNull(vals.windSpeed * 3.6, 1) : roundOrNull(vals.wind_kph, 1));

    return {
      date: isoDate,
      temperature_max_c: roundOrNull(vals.temperatureMax ?? vals.temperature_max_c, 1),
      temperature_min_c: roundOrNull(vals.temperatureMin ?? vals.temperature_min_c, 1),
      temperature_avg_c: roundOrNull(vals.temperatureAvg ?? vals.temperature_avg_c, 1),
      precipitation_probability: roundOrNull(vals.precipitationProbabilityMax ?? vals.precipitationProbabilityAvg ?? vals.precipitation_probability, 0),
      precipitation_mm: roundOrNull(vals.rainAccumulationSum ?? vals.precipitationAccumulationSum ?? vals.precipitation_mm, 1),
      wind_kph: windKph,
      wind_direction: roundOrNull(vals.windDirectionAvg ?? vals.windDirection ?? vals.wind_direction, 0),
      cloud_cover: roundOrNull(vals.cloudCoverAvg ?? vals.cloudCover, 0),
      humidity: roundOrNull(vals.humidityAvg ?? vals.humidity, 0),
      uv_index: roundOrNull(vals.uvIndexMax ?? vals.uvIndex, 0),
      sunrise: vals.sunriseTime || vals.sunrise || null,
      sunset: vals.sunsetTime || vals.sunset || null,
      condition: mapWeatherCondition(vals.weatherCodeMax || vals.weatherCode || vals.weather_code)
    };
  });
}

/**
 * Normalizes alerts if available
 */
function normalizeAlerts(rawAlerts = []) {
  if (!Array.isArray(rawAlerts) || rawAlerts.length === 0) {
    return [];
  }
  return rawAlerts.map(alert => ({
    title: alert.title || alert.event || 'Weather Alert',
    description: alert.description || alert.headline || '',
    severity: alert.severity || 'Unknown',
    start_time: alert.startTime || alert.start_time || '',
    end_time: alert.endTime || alert.end_time || '',
    source: 'Tomorrow.io'
  }));
}

/**
 * GET /api/weather
 * Main consolidated endpoint returning current, hourly, daily (forecast), and alerts
 */
async function getMainWeather(req, res, next) {
  try {
    const loc = await extractLocationParam(req.query);
    if (!loc.isValid) {
      return res.status(loc.statusCode || 400).json({
        success: false,
        error: loc.error || 'Unable to resolve location'
      });
    }

    const [realtimeData, forecastData] = await Promise.all([
      fetchRealtime(loc.locationQuery),
      fetchForecast(loc.locationQuery)
    ]);

    if (!realtimeData && !forecastData) {
      return res.status(502).json({
        success: false,
        error: 'Weather provider request failed'
      });
    }

    const rawLocation = realtimeData?.location || forecastData?.location;
    const location = normalizeLocation(rawLocation, loc.city, loc.lat, loc.lon);
    const current = normalizeCurrent(realtimeData?.data?.values || realtimeData?.data || {});

    if (current.temperature_c === null && (!forecastData || (!forecastData.timelines && !forecastData.daily))) {
      return res.status(502).json({
        success: false,
        error: 'Weather provider request failed'
      });
    }
    
    const hourlyTimelines = forecastData?.timelines?.hourly || forecastData?.timelines?.[0]?.intervals || forecastData?.hourly || [];
    const dailyTimelines = forecastData?.timelines?.daily || forecastData?.timelines?.[1]?.intervals || forecastData?.daily || [];
    
    const hourly = normalizeHourly(hourlyTimelines);
    const daily = normalizeDaily(dailyTimelines);
    const alerts = normalizeAlerts(forecastData?.alerts || realtimeData?.alerts);

    return res.json({
      success: true,
      source: 'Tomorrow.io / Open-Meteo Fallback',
      location,
      current,
      hourly,
      daily,
      forecast: daily,
      alerts,
      metadata: {
        units: 'metric',
        updated_at: realtimeData?.data?.time || new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/weather/current
 */
async function getCurrentWeather(req, res, next) {
  try {
    const loc = await extractLocationParam(req.query);
    if (!loc.isValid) {
      return res.status(loc.statusCode || 400).json({
        success: false,
        error: loc.error || 'Unable to resolve location'
      });
    }

    const realtimeData = await fetchRealtime(loc.locationQuery);
    if (!realtimeData) {
      return res.status(502).json({
        success: false,
        error: 'Weather provider request failed'
      });
    }

    const location = normalizeLocation(realtimeData?.location, loc.city, loc.lat, loc.lon);
    const current = normalizeCurrent(realtimeData?.data?.values || realtimeData?.data || {});

    if (current.temperature_c === null) {
      return res.status(502).json({
        success: false,
        error: 'Weather provider request failed'
      });
    }

    return res.json({
      success: true,
      source: 'Tomorrow.io / Open-Meteo Fallback',
      location,
      current,
      updated_at: realtimeData?.data?.time || new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/weather/hourly
 */
async function getHourlyForecast(req, res, next) {
  try {
    const loc = await extractLocationParam(req.query);
    if (!loc.isValid) {
      return res.status(loc.statusCode || 400).json({
        success: false,
        error: loc.error || 'Unable to resolve location'
      });
    }

    const forecastData = await fetchForecast(loc.locationQuery);
    if (!forecastData) {
      return res.status(502).json({
        success: false,
        error: 'Weather provider request failed'
      });
    }

    const location = normalizeLocation(forecastData?.location, loc.city, loc.lat, loc.lon);
    const hourlyTimelines = forecastData?.timelines?.hourly || forecastData?.timelines?.[0]?.intervals || forecastData?.hourly || [];
    const hourly = normalizeHourly(hourlyTimelines);

    return res.json({
      success: true,
      location,
      hourly,
      forecast: hourly
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/weather/daily
 */
async function getDailyForecast(req, res, next) {
  try {
    const loc = await extractLocationParam(req.query);
    if (!loc.isValid) {
      return res.status(loc.statusCode || 400).json({
        success: false,
        error: loc.error || 'Unable to resolve location'
      });
    }

    const forecastData = await fetchForecast(loc.locationQuery);
    if (!forecastData) {
      return res.status(502).json({
        success: false,
        error: 'Weather provider request failed'
      });
    }

    const location = normalizeLocation(forecastData?.location, loc.city, loc.lat, loc.lon);
    const dailyTimelines = forecastData?.timelines?.daily || forecastData?.timelines?.[1]?.intervals || forecastData?.daily || [];
    const daily = normalizeDaily(dailyTimelines);

    return res.json({
      success: true,
      location,
      daily,
      forecast: daily
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/weather/alerts
 */
async function getWeatherAlerts(req, res, next) {
  try {
    const loc = await extractLocationParam(req.query);
    if (!loc.isValid) {
      return res.status(loc.statusCode || 400).json({
        success: false,
        error: loc.error || 'Unable to resolve location'
      });
    }

    const forecastData = await fetchForecast(loc.locationQuery);
    const alerts = normalizeAlerts(forecastData?.alerts);

    if (alerts.length > 0) {
      return res.json({
        success: true,
        alerts
      });
    }

    return res.json({
      success: true,
      alerts: [],
      message: 'Weather alerts are not available from the current weather provider.'
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/weather/history?location=morbi
 */
async function getHistoricalWeather(req, res, next) {
  try {
    const loc = await extractLocationParam(req.query);
    if (!loc.isValid) {
      return res.status(loc.statusCode || 400).json({
        success: false,
        error: loc.error || 'Unable to resolve location'
      });
    }

    const timezone = req.query.timezone || 'Asia/Kolkata';
    const historyData = await fetchHistory(loc.locationQuery, timezone);

    if (!historyData || !historyData.history || historyData.history.length === 0) {
      return res.status(502).json({
        success: false,
        error: 'Historical weather data is unavailable'
      });
    }

    return res.json({
      success: true,
      source: historyData.source,
      location: {
        name: loc.city || historyData.location.name,
        latitude: loc.lat || historyData.location.latitude,
        longitude: loc.lon || historyData.location.longitude
      },
      period: historyData.period,
      history: historyData.history
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/weather/search?query=...
 * Global City Search & Autocomplete Endpoint
 */
async function searchCitiesController(req, res, next) {
  try {
    const query = req.query.query || req.query.q || req.query.city;
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Search query parameter (query or q) is required'
      });
    }

    const results = await searchCities(query);
    return res.json({
      success: true,
      count: results.length,
      results
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMainWeather,
  getCurrentWeather,
  getHourlyForecast,
  getDailyForecast,
  getWeatherAlerts,
  getHistoricalWeather,
  searchCitiesController
};
