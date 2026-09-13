const axios = require('axios');

async function testNominatimAndPhoton(lat, lon) {
  console.log(`\n==================================================`);
  console.log(`TESTING OPEN GEOCODING AT (${lat}, ${lon})`);
  console.log(`==================================================`);

  // 1. Nominatim Reverse Geocoding
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json', addressdetails: 1 },
      headers: { 'User-Agent': 'WeatherGPT-App/1.0 (sih-hackathon@weathergpt.io)' },
      timeout: 5000
    });
    console.log('Nominatim Display Name:', res.data?.display_name);
    console.log('Nominatim Address Components:', JSON.stringify(res.data?.address, null, 2));
  } catch (err) {
    console.error('Nominatim error:', err.message);
  }

  // 2. Photon Reverse Geocoding
  try {
    const photoRes = await axios.get('https://photon.komoot.io/reverse', {
      params: { lat, lon },
      timeout: 5000
    });
    console.log('\nPhoton Features Count:', photoRes.data?.features?.length);
    if (photoRes.data?.features?.[0]) {
      console.log('Photon Feature [0] Props:', JSON.stringify(photoRes.data.features[0].properties, null, 2));
    }
  } catch (err) {
    console.error('Photon error:', err.message);
  }
}

async function main() {
  await testNominatimAndPhoton(22.58, 70.76); // Near Tankara
  await testNominatimAndPhoton(22.68, 70.83); // Near Panchasiya
}

main();
