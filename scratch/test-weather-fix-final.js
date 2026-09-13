require('dotenv').config();
const http = require('http');
const app = require('../src/app');
const { getWeatherByCoordinates } = require('../src/services/tomorrowService');

let server;

function startServer() {
  return new Promise((resolve) => {
    server = app.listen(5098, () => {
      console.log('Test Express Server listening on port 5098');
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function makeApiRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:5098${path}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    }).on('error', reject);
  });
}

async function runWeatherFixTests() {
  console.log(`==================================================`);
  console.log(`1. TESTING INDIVIDUAL COORDINATES WEATHER FETCHING`);
  console.log(`==================================================`);

  const placesToTest = [
    { name: 'Halvad', lat: 22.91878, lon: 71.01857 },
    { name: 'Dhrangadhra', lat: 23.01022, lon: 71.31447 },
    { name: 'Dasada', lat: 23.03826, lon: 71.68015 },
    { name: 'Viramgam', lat: 23.08324, lon: 71.91255 },
    { name: 'Sanand', lat: 23.05581, lon: 72.23638 },
    { name: 'Vejalpur', lat: 22.98814, lon: 72.5075 },
    { name: 'Morbi', lat: 22.8003959, lon: 70.886232 },
    { name: 'Ahmedabad', lat: 23.0215374, lon: 72.5800568 }
  ];

  for (const p of placesToTest) {
    const w = await getWeatherByCoordinates(p.lat, p.lon, p.name);
    console.log(`Result for ${p.name}:`, w ? 'SUCCESS (Weather populated)' : 'FAILED (null)');
    if (w) {
      console.log(` ${p.name} Weather Payload:`, JSON.stringify(w, null, 2));
    }
  }

  console.log(`\n==================================================`);
  console.log(`2. TESTING ROUTE ENDPOINT: Morbi -> Ahmedabad`);
  console.log(`==================================================`);

  await startServer();

  try {
    const res = await makeApiRequest('/api/route-weather?source=Morbi&destination=Ahmedabad');
    console.log('HTTP Status:', res.status);
    console.log('Success:', res.json?.success);
    console.log('Route Summary:', JSON.stringify(res.json?.route, null, 2));
    console.log('Discovered Places Count:', res.json?.places?.length);

    console.log('\nFINAL API RESPONSE JSON SAMPLE (Places):');
    console.log(JSON.stringify(res.json?.places, null, 2));

  } catch (err) {
    console.error('API Test Error:', err);
  } finally {
    await stopServer();
    process.exit(0);
  }
}

runWeatherFixTests();
