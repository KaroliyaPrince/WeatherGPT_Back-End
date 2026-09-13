require('dotenv').config();
const axios = require('axios');

async function testTomorrowCoordinates(lat, lon, placeName) {
  const apiKey = process.env.TOMORROW_API_KEY;
  console.log(`\n==================================================`);
  console.log(`TESTING TOMORROW.IO WEATHER FOR: ${placeName} (${lat}, ${lon})`);
  console.log(`API KEY: ${apiKey ? 'CONFIGURED' : 'MISSING'}`);
  console.log(`==================================================`);

  if (!apiKey) {
    console.error('TOMORROW_API_KEY is missing in .env!');
    return;
  }

  // 1. Test Realtime Endpoint: GET https://api.tomorrow.io/v4/weather/realtime
  console.log(`Calling Realtime endpoint: https://api.tomorrow.io/v4/weather/realtime?location=${lat},${lon}...`);
  try {
    const t0 = Date.now();
    const resRealtime = await axios.get('https://api.tomorrow.io/v4/weather/realtime', {
      params: { location: `${lat},${lon}`, units: 'metric', apikey: apiKey },
      timeout: 8000
    });
    console.log(`Realtime Response [${Date.now() - t0} ms]:`, JSON.stringify(resRealtime.data, null, 2));
  } catch (err) {
    console.error('Realtime Error Status:', err.response?.status);
    console.error('Realtime Error Data:', err.response?.data || err.message);
  }

  // 2. Test Forecast Endpoint: GET https://api.tomorrow.io/v4/weather/forecast
  console.log(`\nCalling Forecast endpoint: https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}...`);
  try {
    const t0 = Date.now();
    const resForecast = await axios.get('https://api.tomorrow.io/v4/weather/forecast', {
      params: { location: `${lat},${lon}`, units: 'metric', apikey: apiKey },
      timeout: 8000
    });
    console.log(`Forecast Response [${Date.now() - t0} ms]:`, JSON.stringify(resForecast.data, null, 2));
  } catch (err) {
    console.error('Forecast Error Status:', err.response?.status);
    console.error('Forecast Error Data:', err.response?.data || err.message);
  }
}

async function main() {
  await testTomorrowCoordinates(22.91878, 71.01857, 'Halvad');
  await testTomorrowCoordinates(23.01022, 71.31447, 'Dhrangadhra');
  await testTomorrowCoordinates(23.03826, 71.68015, 'Dasada');
  await testTomorrowCoordinates(23.08324, 71.91255, 'Viramgam');
  await testTomorrowCoordinates(23.05581, 72.23638, 'Sanand');
  await testTomorrowCoordinates(22.98814, 72.50750, 'Vejalpur');
  await testTomorrowCoordinates(22.8003959, 70.886232, 'Morbi');
  await testTomorrowCoordinates(23.0215374, 72.5800568, 'Ahmedabad');
}

main();
