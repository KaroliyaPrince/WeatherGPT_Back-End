require('dotenv').config();
const http = require('http');
const app = require('../src/app');

let server;

function startServer() {
  return new Promise((resolve) => {
    server = app.listen(5099, () => {
      console.log('Test Express Server listening on port 5099');
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
    http.get(`http://localhost:5099${path}`, (res) => {
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

async function runFinalTests() {
  await startServer();

  try {
    // TEST 1: Morbi -> Rajkot
    console.log(`\n==================================================`);
    console.log(`TEST 1: GET /api/route-weather?source=Morbi&destination=Rajkot`);
    console.log(`==================================================`);
    const res1 = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    console.log('HTTP Status:', res1.status);
    console.log('Success:', res1.json?.success);
    console.log('Route Summary:', res1.json?.route);
    console.log('Discovered Places Count:', res1.json?.places?.length);
    console.log('Places List:');
    res1.json?.places?.forEach((p, idx) => {
      console.log(` [${idx}] ${p.name} (${p.type}) | ${p.distance_from_start_km} km | Weather: ${p.weather?.condition || 'N/A'}, ${p.weather?.temperature_c || 'N/A'}°C`);
    });

    // TEST 2: Morbi -> Mumbai
    console.log(`\n==================================================`);
    console.log(`TEST 2: GET /api/route-weather?source=Morbi&destination=Mumbai`);
    console.log(`==================================================`);
    const res2 = await makeApiRequest('/api/route-weather?source=Morbi&destination=Mumbai');
    console.log('HTTP Status:', res2.status);
    console.log('Success:', res2.json?.success);
    console.log('Route Summary:', res2.json?.route);
    console.log('Discovered Places Count:', res2.json?.places?.length);
    console.log('Places List:');
    res2.json?.places?.forEach((p, idx) => {
      console.log(` [${idx}] ${p.name} (${p.type}) | ${p.distance_from_start_km} km | Weather: ${p.weather?.condition || 'N/A'}, ${p.weather?.temperature_c || 'N/A'}°C`);
    });

  } catch (err) {
    console.error('Test Execution Error:', err);
  } finally {
    await stopServer();
    process.exit(0);
  }
}

runFinalTests();
