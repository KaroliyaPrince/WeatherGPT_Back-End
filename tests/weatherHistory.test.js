const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const cacheService = require('../src/services/cacheService');

let server;
let baseUrl;

function startTestServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server listening on ${baseUrl}`);
      resolve();
    });
  });
}

function stopTestServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(resolve);
    } else {
      resolve();
    }
  });
}

function makeApiRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(baseUrl + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, json });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function runWeatherHistoryTests() {
  console.log('\n==================================================');
  console.log('RUNNING WEATHER HISTORY & LOCATION BUG TEST SUITE');
  console.log('==================================================\n');

  await startTestServer();

  let passed = 0;
  let failed = 0;

  function check(condition, message) {
    if (condition) {
      console.log(`  ✓ PASSED: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAILED: ${message}`);
      failed++;
    }
  }

  try {
    // TEST 1: Morbi Canonical Location Resolution
    console.log('[TEST 1] Morbi Canonical Location Resolution');
    const res1 = await makeApiRequest('/api/weather?location=morbi');
    check(res1.status === 200, 'HTTP status is 200 for location=morbi');
    check(res1.json?.success === true, 'Response success is true');
    check(res1.json?.location?.name === 'Morbi', 'Location name is canonical "Morbi"');
    check(res1.json?.location?.latitude === 22.8004, 'Latitude is canonical 22.8004');
    check(res1.json?.location?.longitude === 70.8862, 'Longitude is canonical 70.8862');
    check(res1.json?.current?.temperature_c !== null, 'Current temperature is non-null');

    // TEST 2: Unknown City Resolution Error (No success=true with nulls)
    console.log('\n[TEST 2] Unknown City Error Handling');
    const res2 = await makeApiRequest('/api/weather?location=non_existent_city_xyz_99');
    check(res2.status === 404 || res2.status === 400, 'HTTP status is 4xx for unknown city');
    check(res2.json?.success === false, 'Response success is false');
    check(res2.json?.error === 'Unable to resolve location', 'Useful error message returned');

    // TEST 3: Current Weather Endpoint
    console.log('\n[TEST 3] GET /api/weather/current');
    const res3 = await makeApiRequest('/api/weather/current?city=morbi');
    check(res3.status === 200, 'HTTP status 200 for current weather');
    check(res3.json?.current?.temperature_c !== null, 'Temperature is populated');
    check(res3.json?.current?.humidity !== null, 'Humidity is populated');

    // TEST 4: Historical Weather Endpoint (GET /api/weather/history)
    console.log('\n[TEST 4] GET /api/weather/history?location=morbi');
    const res4 = await makeApiRequest('/api/weather/history?location=morbi');
    check(res4.status === 200, 'HTTP status 200 for history endpoint');
    check(res4.json?.success === true, 'Response success is true');
    check(res4.json?.period?.days === 7, 'Period days is 7');
    check(Array.isArray(res4.json?.history) && res4.json?.history.length === 7, 'History contains exactly 7 daily records');

    const history = res4.json?.history || [];

    // TEST 5: Consecutive Dates & Exclusion of Today
    console.log('\n[TEST 5] Consecutive Dates & Today Exclusion');
    const dates = history.map(h => h.date);
    check(dates.length === 7, '7 date records present');

    let consecutive = true;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]).getTime();
      const curr = new Date(dates[i]).getTime();
      if (curr - prev !== 86400000) {
        consecutive = false;
        break;
      }
    }
    check(consecutive, `Dates are strictly consecutive: ${dates.join(', ')}`);

    const todayLocalStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
    check(!dates.includes(todayLocalStr), `Today's date (${todayLocalStr}) is excluded from completed history`);

    // TEST 6: Historical Mapping Integrity
    console.log('\n[TEST 6] Historical Record Fields Mapping Integrity');
    const sampleDay = history[0];
    check(typeof sampleDay.temperature?.min_c === 'number', 'temperature.min_c is numeric');
    check(typeof sampleDay.temperature?.max_c === 'number', 'temperature.max_c is numeric');
    check(typeof sampleDay.temperature?.avg_c === 'number', 'temperature.avg_c is numeric');
    check(typeof sampleDay.humidity?.avg_percent === 'number', 'humidity.avg_percent is numeric');
    check(typeof sampleDay.wind?.max_kph === 'number', 'wind.max_kph is numeric');
    check(typeof sampleDay.precipitation?.accumulation_mm === 'number', 'precipitation.accumulation_mm is numeric');
    check(typeof sampleDay.condition?.text === 'string', 'condition.text is a valid string');

    // TEST 7: Historical Cache Behavior
    console.log('\n[TEST 7] Historical Weather Cache');
    const res7a = await makeApiRequest('/api/weather/history?location=morbi');
    const res7b = await makeApiRequest('/api/weather/history?location=morbi');
    check(res7a.status === 200 && res7b.status === 200, 'HTTP 200 on repeated history requests');
    check(JSON.stringify(res7a.json) === JSON.stringify(res7b.json), 'Repeated calls return 100% deterministic cached history payload');

    // TEST 8: Route Weather Integration Preservation
    console.log('\n[TEST 8] Route Weather Preserved (/api/route-weather)');
    const res8 = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    check(res8.status === 200, 'HTTP 200 for route-weather endpoint');
    check(res8.json?.places?.length >= 3, 'Route weather returns intermediate places');

    console.log('\n==================================================');
    console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
    console.log('==================================================\n');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await stopTestServer();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runWeatherHistoryTests();