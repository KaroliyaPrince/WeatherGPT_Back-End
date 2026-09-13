const axios = require('axios');

async function testBBoxQuery() {
  // Morbi to Rajkot bounding box: (22.25, 70.70, 22.85, 70.95)
  const query = `[out:json][timeout:5];node["place"~"city|town|village|municipality"](22.25,70.70,22.85,70.95);out body;`;

  console.log('Testing Overpass BBOX query:', query);
  const t0 = Date.now();

  try {
    const res = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(query)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)'
        },
        timeout: 5000
      }
    );

    const elements = res.data?.elements || [];
    console.log(`Overpass BBOX succeeded in ${Date.now() - t0} ms, found ${elements.length} elements!`);
    elements.slice(0, 15).forEach(el => {
      console.log(` - ${el.tags?.name} (${el.tags?.place}) @ (${el.lat}, ${el.lon})`);
    });
  } catch (err) {
    console.error('Overpass error:', err.message);
  }
}

testBBoxQuery();
