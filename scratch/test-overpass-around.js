const axios = require('axios');
const { geocodeLocation, computeGoogleRoute, sampleRouteGeometry, buildRouteIndex, projectPointToRoute } = require('../src/services/googleRoutesService');

async function testAroundQuery() {
  console.log('--- Testing Overpass around query ---');

  const source = await geocodeLocation('Morbi');
  const dest = await geocodeLocation('Rajkot');
  const routeData = await computeGoogleRoute(source, dest);
  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // Sample route points every 10 km
  const samples = sampleRouteGeometry(routeData.polylinePoints, 10);
  console.log(`Sample count: ${samples.length}`);

  // Construct an Overpass query using around with multiple lat/lng centers
  // e.g. node["place"~"city|town|village|municipality"](around:5000, lat1, lon1, lat2, lon2, ...);
  const coordsStr = samples.map(s => `${s.latitude},${s.longitude}`).join(',');
  const query = `[out:json][timeout:10];node["place"~"city|town|village|municipality"](around:5000,${coordsStr});out body;`;

  console.log('Querying Overpass around multiple samples...');
  const t0 = Date.now();
  try {
    const res = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(query)}`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    );
    console.log(`Overpass answered in ${Date.now() - t0} ms with ${res.data?.elements?.length} elements.`);

    const candidates = [];
    for (const el of res.data?.elements || []) {
      const name = el.tags?.name || el.tags?.['name:en'];
      if (!name) continue;
      const proj = projectPointToRoute(el.lat, el.lon, routeIndex);
      if (proj.distanceFromRouteKm <= 2.0) {
        candidates.push({
          name,
          placeType: el.tags?.place,
          distFromRoute: proj.distanceFromRouteKm,
          distFromStart: proj.distanceFromStartKm
        });
      }
    }

    candidates.sort((a, b) => a.distFromStart - b.distFromStart);
    console.log(`\nDiscovered ${candidates.length} accepted route settlements within 2km:`);
    for (const c of candidates) {
      console.log(` - ${c.name} (${c.placeType}) @ ${c.distFromStart} km (off by ${c.distFromRoute} km)`);
    }
  } catch (err) {
    console.error('Overpass error:', err.message);
  }
}

testAroundQuery();
