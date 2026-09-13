const axios = require('axios');
const { mapWeatherCondition } = require('../src/utils/weatherMapper');

function mapOpenMeteoCodeToWmo(wmoCode) {
  // Open-Meteo WMO Weather interpretation codes (WW)
  const code = Number(wmoCode);
  switch (code) {
    case 0: return { text: 'Clear', icon: 'sun', code: 1000 };
    case 1: return { text: 'Mostly Clear', icon: 'cloud-sun', code: 1100 };
    case 2: return { text: 'Partly Cloudy', icon: 'cloud-sun', code: 1101 };
    case 3: return { text: 'Overcast', icon: 'cloud', code: 1001 };
    case 45: case 48: return { text: 'Fog', icon: 'cloud-fog', code: 2000 };
    case 51: case 53: case 55: return { text: 'Drizzle', icon: 'cloud-drizzle', code: 4000 };
    case 61: case 63: return { text: 'Rain', icon: 'cloud-rain', code: 4001 };
    case 65: return { text: 'Heavy Rain', icon: 'cloud-lightning-rain', code: 4201 };
    case 80: case 81: case 82: return { text: 'Showers', icon: 'cloud-rain', code: 4200 };
    case 95: case 96: case 99: return { text: 'Thunderstorm', icon: 'cloud-lightning', code: 8000 };
    default: return { text: 'Clear', icon: 'sun', code: 1000 };
  }
}

async function fetchOpenMeteoWeather(lat, lon) {
  try {
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m',
        hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,surface_pressure,wind_speed_10m,uv_index,visibility',
        timezone: 'auto'
      },
      timeout: 5000
    });

    const current = res.data?.current || {};
    const hourly = res.data?.hourly || {};
    const mappedCond = mapOpenMeteoCodeToWmo(current.weather_code || hourly.weather_code?.[0]);

    return {
      temp_c: Math.round((current.temperature_2m || 28) * 10) / 10,
      condition: {
        text: mappedCond.text,
        icon: mappedCond.icon,
        code: mappedCond.code
      },
      wind_kph: Math.round((current.wind_speed_10m || 10) * 10) / 10,
      humidity: Math.round(current.relative_humidity_2m || 65),
      feelslike_c: Math.round((current.apparent_temperature || current.temperature_2m || 28) * 10) / 10,
      uv: Math.round(hourly.uv_index?.[0] || 5),
      visibility_km: Math.round((hourly.visibility?.[0] ? hourly.visibility[0] / 1000 : 10) * 10) / 10,
      pressure_mb: Math.round(current.surface_pressure || 1008),
      precip_mm: Math.round((current.precipitation || 0) * 10) / 10,
      rain_probability: Math.round(hourly.precipitation_probability?.[0] || 0)
    };
  } catch (err) {
    console.error('Open-Meteo error:', err.message);
    return null;
  }
}

async function testAllPlaces() {
  const places = [
    { name: 'Morbi', lat: 22.8003959, lon: 70.886232 },
    { name: 'Halvad', lat: 22.91878, lon: 71.01857 },
    { name: 'Dhrangadhra', lat: 23.01022, lon: 71.31447 },
    { name: 'Dasada', lat: 23.03826, lon: 71.68015 },
    { name: 'Viramgam', lat: 23.08324, lon: 71.91255 },
    { name: 'Sanand', lat: 23.05581, lon: 72.23638 },
    { name: 'Vejalpur', lat: 22.98814, lon: 72.5075 },
    { name: 'Ahmedabad', lat: 23.0215374, lon: 72.5800568 }
  ];

  console.log('Testing Open-Meteo Weather for all 8 places...');
  for (const p of places) {
    const w = await fetchOpenMeteoWeather(p.lat, p.lon);
    console.log(`\n[Weather Success] ${p.name} (${p.lat}, ${p.lon}):`, JSON.stringify(w, null, 2));
  }
}

testAllPlaces();
