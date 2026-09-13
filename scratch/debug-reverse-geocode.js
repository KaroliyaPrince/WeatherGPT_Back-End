require('dotenv').config();
const axios = require('axios');
const { getGoogleApiKey } = require('../src/services/googleRoutesService');

async function testSingleSample(lat, lon) {
  console.log(`\n==================================================`);
  console.log(`DEBUGGING REVERSE GEOCODE AT (${lat}, ${lon})`);
  console.log(`GOOGLE_MAPS_API_KEY: ${getGoogleApiKey() ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log(`==================================================`);

  // 1. Google Geocoding API
  const apiKey = getGoogleApiKey();
  if (apiKey) {
    try {
      const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { latlng: `${lat},${lon}`, key: apiKey },
        timeout: 5000
      });
      console.log('\n--- Google Geocoding API Raw Results Count:', res.data?.results?.length);
      if (res.data?.results?.[0]) {
        console.log('Google Result [0] Formatted:', res.data.results[0].formatted_address);
        console.log('Google Result [0] Types:', res.data.results[0].types);
        console.log('Google Result [0] Address Components:', JSON.stringify(res.data.results[0].address_components, null, 2));
      }
    } catch (e) {
      console.error('Google Geocode error:', e.message);
    }
  }

  // 2. Nominatim Reverse Geocoding
  try {
    const nomRes = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json', zoom: 14, addressdetails: 1 },
      headers: { 'User-Agent': 'WeatherGPT-App/1.0 (sih-hackathon@weathergpt.io)' },
      timeout: 5000
    });
    console.log('\n--- Nominatim Result (zoom=14):');
    console.log('Name:', nomRes.data?.name || nomRes.data?.display_name);
    console.log('Address:', JSON.stringify(nomRes.data?.address, null, 2));
  } catch (e) {
    console.error('Nominatim error:', e.message);
  }

  // 3. Photon Reverse Geocoding
  try {
    const photoRes = await axios.get('https://photon.komoot.io/reverse', {
      params: { lat, lon },
      timeout: 5000
    });
    console.log('\n--- Photon Result:');
    console.log('Properties:', JSON.stringify(photoRes.data?.features?.[0]?.properties, null, 2));
  } catch (e) {
    console.error('Photon error:', e.message);
  }
}

// Sample points along Morbi to Rajkot route:
// Sample 1: Near Tankara (22.58, 70.76)
// Sample 2: Near Mitana (22.51, 70.78)
// Sample 3: Near Panchasiya (22.68, 70.83)
async function main() {
  await testSingleSample(22.58, 70.76);
  await testSingleSample(22.68, 70.83);
}

main();
