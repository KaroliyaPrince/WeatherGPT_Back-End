const axios = require('axios');
const { geocodeLocation, computeGoogleRoute, sampleRouteGeometry, buildRouteIndex, projectPointToRoute } = require('../src/services/googleRoutesService');

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

async function testOverpassMirrors() {
  const source = await geocodeLocation('Morbi');
  const dest = await geocodeLocation('Rajkot');
  const routeData = await computeGoogleRoute(source, dest);
  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  const samples = sampleRouteGeometry(routeData.polylinePoints, 10);
  console.log(`Sample count: ${samples.length}`);

  // Construct query with bounding box or around
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of routeData.polylinePoints) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }
  const pad = 0.05;
  const bbox = `${minLat - pad},${minLon - pad},${maxLat + pad},${maxLon + pad}`;
  const query = `[out:json][timeout:5];node["place"~"city|town|village|municipality"](${bbox});out body;`;

  for (const ep of OVERPASS_ENDPOINTS) {
    console.log(`Trying Overpass mirror: ${ep}...`);
    const t0 = Date.now();
    try {
      const res = await axios.post(ep, `data=${encodeURIComponent(query)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000
      });
      const elements = res.data?.elements || [];
      console.log(`SUCCESS on ${ep}: returned ${elements.length} elements in ${Date.now() - t0} ms!`);

      const candidates = [];
      for (const el of elements) {
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
      console.log(`Accepted candidates (${candidates.length}):`);
      for (const c of candidates) {
        console.log(` - ${c.name} (${c.placeType}) @ ${c.distFromStart} km (off by ${c.distFromRoute} km)`);
      }
      break;
    } catch (err) {
      console.warn(`Failed on ${ep}: ${err.message}`);
    }
  }
}

testOverpassMirrors();
