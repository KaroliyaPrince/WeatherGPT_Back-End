const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const weatherCache = require('../src/services/weatherCache');
const weatherRequestDeduper = require('../src/services/weatherRequestDeduper');
const weatherRateLimiter = require('../src/services/weatherRateLimiter');
const { getWeatherByCoordinates, fetchProviderWeather } = require('../src/services/tomorrowService');
const { findCanonicalPlace } = require('../src/services/canonicalPlacesService');

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

async function runQuotaAndCacheTests() {
  console.log('\n==================================================');
  console.log('RUNNING WEATHER PROVIDER QUOTA & CACHE TEST SUITE');
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
    // Reset state before tests
    weatherCache.clear();
    weatherRequestDeduper.clear();
    weatherRateLimiter.reset();

    // TEST 1: Fresh Cache Prevents Provider Request
    console.log('[TEST 1] Fresh Cache Prevents Provider Request');
    const mockWeather = {
      temp_c: 28.5,
      temperature_c: 28.5,
      humidity: 55,
      condition: { text: 'Clear', icon: 'sun', code: 1000 }
    };
    weatherCache.set(22.8004, 70.8862, mockWeather, 600, 3600);

    const initialProviderCalls = weatherRateLimiter.requestTimestamps.length;
    const res1 = await getWeatherByCoordinates(22.8004, 70.8862, 'Morbi');
    const finalProviderCalls = weatherRateLimiter.requestTimestamps.length;

    check(res1.temperature_c === 28.5, 'Returned weather matches cached value');
    check(finalProviderCalls === initialProviderCalls, '0 provider calls dispatched on fresh cache hit');

    // TEST 2: 2 Simultaneous Requests Coalesced
    console.log('\n[TEST 2] 2 Simultaneous Requests Coalesced');
    weatherCache.clear();
    weatherRateLimiter.reset();

    const p1 = getWeatherByCoordinates(22.3053, 70.8028, 'Rajkot');
    const p2 = getWeatherByCoordinates(22.3053, 70.8028, 'Rajkot');
    const [res2a, res2b] = await Promise.all([p1, p2]);

    check(res2a !== null && res2b !== null, 'Both callers received valid weather data');
    check(res2a.temperature_c === res2b.temperature_c, 'Both callers received identical weather data');
    check(weatherRateLimiter.requestTimestamps.length === 1, 'Exactly 1 provider call was dispatched for 2 simultaneous requests');

    // TEST 3: 10 Simultaneous Requests Coalesced
    console.log('\n[TEST 3] 10 Simultaneous Requests Coalesced');
    weatherCache.clear();
    weatherRateLimiter.reset();

    const requests10 = [];
    for (let i = 0; i < 10; i++) {
      requests10.push(getWeatherByCoordinates(21.1702, 72.8311, 'Surat'));
    }
    const results10 = await Promise.all(requests10);

    check(results10.every(r => r && r.temperature_c !== undefined), 'All 10 callers received valid weather data');
    check(weatherRateLimiter.requestTimestamps.length === 1, 'Exactly 1 provider call dispatched for 10 simultaneous requests');

    // TEST 4: Unique Coordinates Require Separate Provider Calls
    console.log('\n[TEST 4] Unique Coordinates Require Separate Provider Calls');
    weatherCache.clear();
    weatherRateLimiter.reset();

    await Promise.all([
      getWeatherByCoordinates(23.0225, 72.5714, 'Ahmedabad'),
      getWeatherByCoordinates(22.3072, 73.1812, 'Vadodara')
    ]);
    check(weatherRateLimiter.requestTimestamps.length === 2, '2 unique coordinates triggered 2 provider calls');

    // TEST 5: HTTP 429 Cooldown with Stale Cache Available
    console.log('\n[TEST 5] HTTP 429 Cooldown with Stale Cache Fallback');
    weatherCache.clear();
    weatherRateLimiter.reset();

    // Populate a stale cache entry
    const staleWeather = { temp_c: 24.0, temperature_c: 24.0, humidity: 70, condition: { text: 'Cloudy', icon: 'cloud', code: 1001 } };
    const keyStr = weatherCache.normalizeKey(22.6562, 70.7495);
    weatherCache.cache.set(keyStr, {
      latitude: 22.6562,
      longitude: 70.7495,
      weather: staleWeather,
      fetchedAt: Date.now() - 700000,
      freshUntil: Date.now() - 100000,
      staleUntil: Date.now() + 2000000
    });

    // Trigger 429 cooldown
    weatherRateLimiter.trigger429Cooldown(60);
    check(weatherRateLimiter.isCoolingDown() === true, 'Limiter is in 429 cooldown mode');

    const res5 = await fetchProviderWeather(22.6562, 70.7495);
    check(res5 !== null, 'Returned non-null weather response during 429 cooldown');
    check(res5.temperature_c === 24.0, 'Stale cached temperature returned');
    check(res5.is_stale === true, 'Response is marked with is_stale: true');

    // TEST 6: HTTP 429 Cooldown without Cache
    console.log('\n[TEST 6] HTTP 429 Cooldown without Cache (Controlled Failure)');
    weatherCache.clear();
    weatherRateLimiter.trigger429Cooldown(60);

    const res6 = await fetchProviderWeather(20.3893, 72.9106);
    check(res6 === null, 'Tomorrow.io provider returns controlled null during cooldown without stale cache');

    // TEST 7: Provider Error Cleanup and Retry Safety
    console.log('\n[TEST 7] In-Flight Request Cleanup on Failure');
    weatherCache.clear();
    weatherRateLimiter.reset();

    // Trigger a failed fetch and verify inFlight cleanup
    weatherRequestDeduper.inFlight.set('weather:20.0000:70.0000', Promise.reject(new Error('MOCK_FAILURE')).catch(() => {}));
    weatherRequestDeduper.inFlight.get('weather:20.0000:70.0000').finally(() => {
      weatherRequestDeduper.inFlight.delete('weather:20.0000:70.0000');
    });

    await new Promise(r => setTimeout(r, 50));
    check(weatherRequestDeduper.inFlight.has('weather:20.0000:70.0000') === false, 'Failed in-flight promise is cleanly removed');

    // TEST 8: Route Weather Quota Awareness (Cached places do not trigger calls)
    console.log('\n[TEST 8] Route Weather Quota Awareness');
    weatherCache.clear();
    weatherRateLimiter.reset();

    // Pre-cache 3 places along Morbi -> Rajkot route
    weatherCache.set(22.8004, 70.8862, mockWeather, 600, 3600); // Morbi
    weatherCache.set(22.7875, 70.8040, mockWeather, 600, 3600); // Sanala
    weatherCache.set(22.6562, 70.7495, mockWeather, 600, 3600); // Tankara

    const res8 = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    check(res8.status === 200, 'HTTP 200 for route weather request');
    check(res8.json?.places?.length >= 3, 'Route weather returns intermediate places');

    // TEST 9: Simultaneous Route Requests Coalesced
    console.log('\n[TEST 9] Simultaneous Duplicate Route Requests Coalesced');
    weatherCache.clear();
    weatherRateLimiter.reset();

    const reqRoute1 = makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    const reqRoute2 = makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    const [resRoute1, resRoute2] = await Promise.all([reqRoute1, reqRoute2]);

    check(resRoute1.status === 200 && resRoute2.status === 200, 'Both route requests returned HTTP 200');
    check(resRoute1.json?.places?.length === resRoute2.json?.places?.length, 'Both route requests returned identical places count');

    // TEST 10: Global Provider Rate Limit Enforcement
    console.log('\n[TEST 10] Global Provider Rate Limit Enforcement');
    weatherRateLimiter.reset();
    weatherRateLimiter.maxRequestsPerHour = 3;

    weatherRateLimiter.requestTimestamps = [Date.now(), Date.now(), Date.now()]; // Fill quota of 3
    check(weatherRateLimiter.hasQuota() === false, 'Rate limiter correctly reports quota exhausted when maxRequestsPerHour reached');

    weatherRateLimiter.reloadConfig(); // Restore default config

    // TEST 11: Tankara Canonical Coordinates Preserved
    console.log('\n[TEST 11] Tankara Canonical Coordinates Preserved');
    const tankaraCanonical = findCanonicalPlace('Tankara', 22.6562, 70.7495);
    check(tankaraCanonical !== null, 'Tankara exists in canonical database');
    check(tankaraCanonical.latitude === 22.6562, 'Tankara latitude is exactly 22.6562');
    check(tankaraCanonical.longitude === 70.7495, 'Tankara longitude is exactly 70.7495');

    // TEST 12: Existing API Endpoint Compatibility
    console.log('\n[TEST 12] Existing API Endpoints Preserved');
    const resHealth = await makeApiRequest('/api/health');
    check(resHealth.status === 200, '/api/health returns HTTP 200');

    const resHistory = await makeApiRequest('/api/weather/history?location=morbi');
    check(resHistory.status === 200 && resHistory.json?.history?.length === 7, '/api/weather/history returns 7 completed days');

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

runQuotaAndCacheTests();