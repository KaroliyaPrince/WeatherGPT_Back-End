const axios = require('axios');

async function testNominatimZooms(lat, lon) {
  console.log(`\nTesting Nominatim reverse geocode at (${lat}, ${lon})...`);

  for (const zoom of [10, 12, 14]) {
    try {
      const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: { lat, lon, format: 'json', zoom, addressdetails: 1 },
        headers: { 'User-Agent': 'WeatherGPT-Production-Backend/1.0 (sih-app@weathergpt.io)' },
        timeout: 4000
      });
      const addr = res.data?.address || {};
      const candidateName = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.locality || addr.county || addr.state_district;
      console.log(`[zoom=${zoom}] Name: ${candidateName} | Display: ${res.data?.name} | City: ${addr.city}, Town: ${addr.town}, Village: ${addr.village}, County: ${addr.county}`);
    } catch (err) {
      console.error(`[zoom=${zoom}] Error: ${err.message}`);
    }
  }
}

async function main() {
  await testNominatimZooms(22.58, 70.76); // Tankara
  await testNominatimZooms(22.51, 70.78); // Mitana
  await testNominatimZooms(22.68, 70.83); // Panchasiya
}

main();
