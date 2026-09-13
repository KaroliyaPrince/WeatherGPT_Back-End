const axios = require('axios');

async function testOverpassSyntax() {
  // Coordinates along Morbi to Rajkot route
  // e.g., Tankara (22.58, 70.76), Panchasiya (22.68, 70.83), Mitana (22.51, 70.78), etc.
  const coordsStr = '22.80,70.88,22.68,70.83,22.58,70.76,22.51,70.78,22.40,70.79,22.30,70.80';
  const query = `[out:json][timeout:10];node(around:5000,${coordsStr})["place"~"city|town|village|municipality"];out body;`;

  console.log('Testing Overpass query:', query);
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
        timeout: 8000
      }
    );

    const elements = res.data?.elements || [];
    console.log(`Overpass succeeded in ${Date.now() - t0} ms, found ${elements.length} elements!`);
    elements.forEach(el => {
      console.log(` - ${el.tags?.name} (${el.tags?.place}) @ (${el.lat}, ${el.lon})`);
    });
  } catch (err) {
    console.error('Overpass error:', err.message, err.response?.data);
  }
}

testOverpassSyntax();
