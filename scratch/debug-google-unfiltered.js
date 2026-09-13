require('dotenv').config();
const axios = require('axios');
const { getGoogleApiKey } = require('../src/services/googleRoutesService');

async function testGoogleGeocodeRaw(lat, lon) {
  const apiKey = getGoogleApiKey();
  console.log(`\nTesting Google Geocode API Raw for (${lat}, ${lon})...`);
  console.log(`API Key: ${apiKey}`);

  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { latlng: `${lat},${lon}`, key: apiKey },
      timeout: 5000
    });
    console.log(`Status from Google API: ${res.data?.status}`);
    console.log(`Error Message: ${res.data?.error_message}`);
    console.log(`Full Response:`, JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testGoogleGeocodeRaw(22.58, 70.76);
