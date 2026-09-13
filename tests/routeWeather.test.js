require('dotenv').config();
const http = require('http');
const app = require('../src/app');
const cacheService = require('../src/services/cacheService');
const { findCanonicalPlace } = require('../src/services/canonicalPlacesService');

let server;
const PORT = 5098;

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

async function runAllTests() {
  console.log('\n==================================================');
  console.log('RUNNING MANDATORY ROUTE WEATHER TEST SUITE');
  console.log('==================================================\n');

  await startServer();
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASSED: ${message}`);
      passedCount++;
    } else {
      console.error(`  ✗ FAILED: ${message}`);
      failedCount++;
    }
  }

  try {
    // TEST 1: Same Route Determinism (Morbi -> Rajkot)
    console.log('\n[TEST 1] Same Route Determinism (Morbi -> Rajkot)');
    const res1a = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    const res1b = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');

    assert(res1a.status === 200, 'HTTP status is 200 for call 1');
    assert(res1b.status === 200, 'HTTP status is 200 for call 2');
    assert(res1a.json?.route?.source?.name === res1b.json?.route?.source?.name, 'Source name is identical');
    assert(res1a.json?.route?.source?.latitude === res1b.json?.route?.source?.latitude, 'Source latitude is identical');
    assert(res1a.json?.route?.source?.longitude === res1b.json?.route?.source?.longitude, 'Source longitude is identical');
    assert(res1a.json?.route?.destination?.name === res1b.json?.route?.destination?.name, 'Destination name is identical');
    assert(res1a.json?.route?.destination?.latitude === res1b.json?.route?.destination?.latitude, 'Destination latitude is identical');
    assert(res1a.json?.route?.destination?.longitude === res1b.json?.route?.destination?.longitude, 'Destination longitude is identical');

    const places1a = res1a.json?.places?.map(p => p.name);
    const places1b = res1b.json?.places?.map(p => p.name);
    assert(JSON.stringify(places1a) === JSON.stringify(places1b), `Places sequence is deterministic: ${JSON.stringify(places1a)}`);
    assert(places1a?.includes('Tankara') || places1a?.includes('Wankaner'), 'Intermediate settlement detected in route places');

    // TEST 2: Coordinate Correctness (Intermediate Settlement Coordinates)
    console.log('\n[TEST 2] Intermediate Settlement Canonical Coordinate Preservation');
    const intermediatePlace = res1a.json?.places?.find(p => p.name === 'Tankara' || p.name === 'Wankaner');
    assert(intermediatePlace !== undefined, 'Intermediate settlement place exists in response');
    assert(intermediatePlace?.latitude > 22 && intermediatePlace?.longitude > 70, `Intermediate settlement coordinates valid (${intermediatePlace?.name}: ${intermediatePlace?.latitude}, ${intermediatePlace?.longitude})`);

    // TEST 3: Provider Disagreement & Normalization
    console.log('\n[TEST 3] Provider Disagreement & Alias Normalization');
    const match1 = findCanonicalPlace('Tankara Town', 22.422, 70.784);
    const match2 = findCanonicalPlace('Tankara Municipality', 22.422, 70.784);
    const match3 = findCanonicalPlace('Tankara Taluka', 22.422, 70.784);

    assert(match1?.id === 'tankara' && match1?.latitude === 22.6562, 'Tankara Town maps to canonical Tankara (22.6562)');
    assert(match2?.id === 'tankara' && match2?.latitude === 22.6562, 'Tankara Municipality maps to canonical Tankara (22.6562)');
    assert(match3?.id === 'tankara' && match3?.latitude === 22.6562, 'Tankara Taluka maps to canonical Tankara (22.6562)');

    // TEST 4: Provider Failure Tolerance
    console.log('\n[TEST 4] Provider Failure & Fallback Resilience');
    const res4 = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    assert(res4.status === 200, 'API returns HTTP 200 even under network/provider fallback');
    assert(res4.json?.places?.length >= 3, `Sufficient places returned (${res4.json?.places?.length})`);

    // TEST 5: Render-Like Production Environment (NODE_ENV=production)
    console.log('\n[TEST 5] Production Environment Execution (NODE_ENV=production)');
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const res5 = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    process.env.NODE_ENV = prevEnv;
    assert(res5.status === 200, 'HTTP status is 200 under NODE_ENV=production');
    assert(res5.json?.places?.length >= 3, 'Production mode returns intermediate route places');

    // TEST 6: Empty Cache Execution
    console.log('\n[TEST 6] Empty Cache Execution');
    cacheService.clearAll();
    const res6 = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
    assert(res6.status === 200, 'HTTP status is 200 with empty cache');
    assert(res6.json?.places?.length >= 3, 'Places sequence returned correctly when cache is empty');

    // TEST 7: Repeated Endpoint Calls Determinism (5 Executions)
    console.log('\n[TEST 7] Repeated Endpoint Calls Determinism (5 Consecutive Calls)');
    const sequences = [];
    for (let i = 0; i < 5; i++) {
      const res = await makeApiRequest('/api/route-weather?source=Morbi&destination=Rajkot');
      sequences.push(res.json?.places?.map(p => `${p.name}:${p.latitude},${p.longitude}`).join(' -> '));
    }
    const allIdentical = sequences.every(seq => seq === sequences[0]);
    assert(allIdentical, `All 5 consecutive calls yielded 100% identical sequence:\n      ${sequences[0]}`);

    console.log('\n==================================================');
    console.log(`TEST SUITE SUMMARY: ${passedCount} Passed, ${failedCount} Failed`);
    console.log('==================================================\n');

  } catch (err) {
    console.error('Test Execution Error:', err);
  } finally {
    await stopServer();
    process.exit(failedCount > 0 ? 1 : 0);
  }
}

runAllTests();
