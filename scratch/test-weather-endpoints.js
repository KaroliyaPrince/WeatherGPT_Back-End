require('dotenv').config();
const http = require('http');
const app = require('../src/app');

let server;
const PORT = 5097;

function startServer() {
  return new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`Test Express Server listening on port ${PORT}`);
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
    http.get(`http://localhost:${PORT}${path}`, (res) => {
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

async function runTests() {
  await startServer();

  try {
    console.log('\n==================================================');
    console.log('TESTING ALL /api/weather ENDPOINTS');
    console.log('==================================================\n');

    // 1. GET /api/weather/current?city=morbi
    console.log('[TEST 1] GET /api/weather/current?city=morbi');
    const res1 = await makeApiRequest('/api/weather/current?city=morbi');
    console.log('HTTP Status:', res1.status);
    console.log('Response JSON:', JSON.stringify(res1.json, null, 2));

    // 2. GET /api/weather?city=morbi
    console.log('\n[TEST 2] GET /api/weather?city=morbi');
    const res2 = await makeApiRequest('/api/weather?city=morbi');
    console.log('HTTP Status:', res2.status);
    console.log('Location:', res2.json?.location);
    console.log('Current Temp:', res2.json?.current?.temperature_c, '°C');
    console.log('Condition:', res2.json?.current?.condition?.text);
    console.log('Hourly Count:', res2.json?.hourly?.length);
    console.log('Daily Count:', res2.json?.daily?.length);

    // 3. GET /api/weather/hourly?city=morbi
    console.log('\n[TEST 3] GET /api/weather/hourly?city=morbi');
    const res3 = await makeApiRequest('/api/weather/hourly?city=morbi');
    console.log('HTTP Status:', res3.status);
    console.log('Hourly Count:', res3.json?.hourly?.length);
    console.log('Sample Hourly Item [0]:', res3.json?.hourly?.[0]);

    // 4. GET /api/weather/daily?city=morbi
    console.log('\n[TEST 4] GET /api/weather/daily?city=morbi');
    const res4 = await makeApiRequest('/api/weather/daily?city=morbi');
    console.log('HTTP Status:', res4.status);
    console.log('Daily Count:', res4.json?.daily?.length);
    console.log('Sample Daily Item [0]:', res4.json?.daily?.[0]);

    // 5. GET /api/weather/current?lat=22.8004&lon=70.8862
    console.log('\n[TEST 5] GET /api/weather/current?lat=22.8004&lon=70.8862');
    const res5 = await makeApiRequest('/api/weather/current?lat=22.8004&lon=70.8862');
    console.log('HTTP Status:', res5.status);
    console.log('Current Temp:', res5.json?.current?.temperature_c, '°C');
    console.log('Humidity:', res5.json?.current?.humidity, '%');

  } catch (err) {
    console.error('Test Execution Error:', err);
  } finally {
    await stopServer();
    process.exit(0);
  }
}

runTests();
