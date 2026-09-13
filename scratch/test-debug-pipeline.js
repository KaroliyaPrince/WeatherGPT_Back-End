const axios = require('axios');
const {
  geocodeLocation,
  computeGoogleRoute,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry
} = require('../src/services/googleRoutesService');

function cleanAdministrativeName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  let name = rawName.trim();

  // Strip administrative suffixes
  name = name.replace(/\b(Taluka|Taluk|District|Tehsil|Tahsil|Sub-District|Subdistrict|Mandalam|County|State|Province|Zone|Municipality)\b/gi, '').trim();
  // Strip trailing commas, dashes, extra spaces
  name = name.replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();

  if (name.length < 2) return null;
  return name;
}

// Test Overpass with fast around query on sampled route points
async function fetchOverpassSettlements(polylinePoints, routeIndex) {
  // Sample route every 8 km for Overpass
  const samples = sampleRouteGeometry(polylinePoints, 8);
  console.log(`[Overpass] Sampling route into ${samples.length} corridor checkpoints...`);

  // Restrict to cities, towns, villages, municipalities
  const coordsStr = samples.map(s => `${s.latitude.toFixed(4)},${s.longitude.toFixed(4)}`).join(',');
  const query = `[out:json][timeout:8];(node["place"~"city|town|village|municipality"](around:5000,${coordsStr});way["place"~"city|town|village|municipality"](around:5000,${coordsStr}););out center;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];

  for (const ep of endpoints) {
    try {
      console.log(`[Overpass] Requesting ${ep}...`);
      const t0 = Date.now();
      const res = await axios.post(ep, `data=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)'
        },
        timeout: 6000
      });
      const duration = Date.now() - t0;
      const elements = res.data?.elements || [];
      console.log(`[Overpass] ${ep} succeeded in ${duration} ms, found ${elements.length} raw places.`);

      const candidates = [];
      for (const el of elements) {
        const name = el.tags?.name || el.tags?.['name:en'];
        const placeType = el.tags?.place || 'village';
        if (!name) continue;

        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;
        if (!lat || !lon) continue;

        const proj = projectPointToRoute(lat, lon, routeIndex);

        if (proj.distanceFromRouteKm <= 2.0) {
          const cleaned = cleanAdministrativeName(name);
          if (cleaned) {
            candidates.push({
              name: cleaned,
              rawName: name,
              latitude: lat,
              longitude: lon,
              placeType,
              distanceFromRouteKm: proj.distanceFromRouteKm,
              distanceFromStartKm: proj.distanceFromStartKm,
              source: 'overpass'
            });
          }
        }
      }
      return candidates;
    } catch (err) {
      console.warn(`[Overpass] Endpoint ${ep} failed: ${err.message}`);
    }
  }

  return [];
}

async function runDebugRoute(sourceName, destName) {
  console.log(`\n==================================================`);
  console.log(`DEBUGGING ROUTE: ${sourceName} -> ${destName}`);
  console.log(`==================================================`);

  const sourceInfo = await geocodeLocation(sourceName);
  const destInfo = await geocodeLocation(destName);

  console.log('Source Geocode:', sourceInfo);
  console.log('Dest Geocode:', destInfo);

  if (!sourceInfo || !destInfo) {
    console.error('Geocoding failed for source or destination');
    return;
  }

  const routeData = await computeGoogleRoute(sourceInfo, destInfo);
  if (!routeData) {
    console.error('Route calculation failed');
    return;
  }

  console.log(`1. Google Route Distance: ${routeData.distance_km} km`);
  console.log(`   Duration: ${routeData.duration_minutes} min`);
  console.log(`2. Decoded polyline points: ${routeData.polylinePoints.length}`);

  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // Overpass Discovery
  const overpassCandidates = await fetchOverpassSettlements(routeData.polylinePoints, routeIndex);
  console.log(`\nOverpass Candidate Settlements within 2km (${overpassCandidates.length}):`);
  overpassCandidates.forEach(c => {
    console.log(` - [${c.source}] ${c.name} (${c.placeType}) @ ${c.distanceFromStartKm} km (off route by ${c.distanceFromRouteKm} km)`);
  });
}

async function main() {
  await runDebugRoute('Morbi', 'Rajkot');
  await runDebugRoute('Morbi', 'Mumbai');
}

main();
