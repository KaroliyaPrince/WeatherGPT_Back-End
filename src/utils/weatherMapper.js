/**
 * Official Tomorrow.io & Standard WMO Weather Code Mapper
 */

const WEATHER_CODES = {
  0: { text: 'Unknown', icon: 'help-circle', code: 0 },
  1: { text: 'Mostly Clear', icon: 'cloud-sun', code: 1100 },
  2: { text: 'Partly Cloudy', icon: 'cloud-sun', code: 1101 },
  3: { text: 'Overcast', icon: 'cloud', code: 1001 },
  1000: { text: 'Clear', icon: 'sun', code: 1000 },
  1100: { text: 'Mostly Clear', icon: 'cloud-sun', code: 1100 },
  1101: { text: 'Partly Cloudy', icon: 'cloud-sun', code: 1101 },
  1102: { text: 'Mostly Cloudy', icon: 'cloud', code: 1102 },
  1001: { text: 'Cloudy', icon: 'cloud', code: 1001 },
  2000: { text: 'Fog', icon: 'cloud-fog', code: 2000 },
  2100: { text: 'Light Fog', icon: 'cloud-fog', code: 2100 },
  4000: { text: 'Drizzle', icon: 'cloud-drizzle', code: 4000 },
  4001: { text: 'Rain', icon: 'cloud-rain', code: 4001 },
  4200: { text: 'Light Rain', icon: 'cloud-rain', code: 4200 },
  4201: { text: 'Heavy Rain', icon: 'cloud-lightning-rain', code: 4201 },
  5000: { text: 'Snow', icon: 'snowflake', code: 5000 },
  5001: { text: 'Flurries', icon: 'snowflake', code: 5001 },
  5100: { text: 'Light Snow', icon: 'snowflake', code: 5100 },
  5101: { text: 'Heavy Snow', icon: 'snowflake', code: 5101 },
  6000: { text: 'Freezing Drizzle', icon: 'cloud-sleet', code: 6000 },
  6001: { text: 'Freezing Rain', icon: 'cloud-sleet', code: 6001 },
  6200: { text: 'Light Freezing Rain', icon: 'cloud-sleet', code: 6200 },
  6201: { text: 'Heavy Freezing Rain', icon: 'cloud-sleet', code: 6201 },
  7000: { text: 'Ice Pellets', icon: 'cloud-hail', code: 7000 },
  7101: { text: 'Heavy Ice Pellets', icon: 'cloud-hail', code: 7101 },
  7102: { text: 'Light Ice Pellets', icon: 'cloud-hail', code: 7102 },
  8000: { text: 'Thunderstorm', icon: 'cloud-lightning', code: 8000 }
};

/**
 * Safely rounds numeric values or returns null
 */
function roundOrNull(val, precision = 1) {
  if (val === undefined || val === null || isNaN(val)) return null;
  const factor = Math.pow(10, precision);
  return Math.round(Number(val) * factor) / factor;
}

/**
 * Map weather code to normalized condition object
 * @param {number|string} code - Weather code
 * @returns {object} { text, icon, code }
 */
function mapWeatherCondition(code) {
  const numericCode = Number(code);
  if (!isNaN(numericCode) && WEATHER_CODES[numericCode]) {
    return WEATHER_CODES[numericCode];
  }
  
  return {
    text: 'Clear',
    icon: 'sun',
    code: !isNaN(numericCode) ? numericCode : 1000
  };
}

/**
 * Normalizes historical daily record (from Tomorrow.io or Open-Meteo Archive)
 */
function normalizeHistoricalDailyItem(item) {
  if (!item) return null;

  const vals = item.values || item;
  const isoDate = item.date || (item.time ? item.time.split('T')[0] : null);

  const minTemp = roundOrNull(vals.temperatureMin ?? vals.min_temp_c ?? vals.temp_min_c ?? vals.temperature_2m_min, 1);
  const maxTemp = roundOrNull(vals.temperatureMax ?? vals.max_temp_c ?? vals.temp_max_c ?? vals.temperature_2m_max, 1);
  let avgTemp = roundOrNull(vals.temperatureAvg ?? vals.avg_temp_c ?? vals.temp_mean_c ?? vals.temperature_2m_mean, 1);
  if (avgTemp === null && minTemp !== null && maxTemp !== null) {
    avgTemp = roundOrNull((minTemp + maxTemp) / 2, 1);
  }

  const minHum = roundOrNull(vals.humidityMin ?? vals.min_humidity ?? vals.relative_humidity_2m_min, 0);
  const maxHum = roundOrNull(vals.humidityMax ?? vals.max_humidity ?? vals.relative_humidity_2m_max, 0);
  let avgHum = roundOrNull(vals.humidityAvg ?? vals.humidity ?? vals.avg_humidity ?? vals.relative_humidity_2m_mean, 0);
  if (avgHum === null && minHum !== null && maxHum !== null) {
    avgHum = roundOrNull((minHum + maxHum) / 2, 0);
  }

  const maxWind = roundOrNull(vals.windSpeedMax !== undefined ? vals.windSpeedMax * 3.6 : (vals.max_wind_kph ?? vals.wind_speed_10m_max), 1);
  const avgWind = roundOrNull(vals.windSpeedAvg !== undefined ? vals.windSpeedAvg * 3.6 : (vals.avg_wind_kph ?? vals.wind_speed_10m_mean ?? vals.wind_speed_10m), 1);

  const precipAcc = roundOrNull(vals.rainAccumulationSum ?? vals.precipitationSum ?? vals.precipitation_mm ?? vals.precipitation_sum ?? vals.accumulation_mm, 1) ?? 0;
  const precipProb = roundOrNull(vals.precipitationProbabilityMax ?? vals.precipitationProbabilityAvg ?? vals.precipitation_probability ?? vals.rain_probability, 0) ?? 0;

  const pressAvg = roundOrNull(vals.pressureSurfaceLevelAvg ?? vals.surface_pressure_mean ?? vals.pressure_mb, 0);
  const cloudCover = roundOrNull(vals.cloudCoverAvg ?? vals.cloud_cover_mean ?? vals.cloud_cover, 0);

  const weatherCode = vals.weatherCodeMax ?? vals.weatherCode ?? vals.weather_code ?? 1000;
  const conditionObj = mapWeatherCondition(weatherCode);

  return {
    date: isoDate,
    temperature: {
      min_c: minTemp,
      max_c: maxTemp,
      avg_c: avgTemp
    },
    humidity: {
      min_percent: minHum,
      max_percent: maxHum,
      avg_percent: avgHum
    },
    wind: {
      max_kph: maxWind,
      avg_kph: avgWind
    },
    precipitation: {
      accumulation_mm: precipAcc,
      probability_percent: precipProb
    },
    pressure: {
      avg_mb: pressAvg
    },
    cloud_cover_percent: cloudCover,
    condition: conditionObj
  };
}

module.exports = {
  mapWeatherCondition,
  normalizeHistoricalDailyItem,
  WEATHER_CODES
};
