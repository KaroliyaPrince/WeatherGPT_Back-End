const axios = require('axios');
const { geocodeLocation, computeGoogleRoute, sampleRouteGeometry, buildRouteIndex, projectPointToRoute } = require('../src/services/googleRoutesService');

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

async function fetchOverpassNodes(bbox) {
  const query = `[out:json][timeout:15];node["place"~"city|town|village|municipality"](${bbox});out body;`;
  
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying Overpass endpoint: ${endpoint}`);
      const res = await axios.post(
        endpoint,
        `data=${encodeURIComponent(query)}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 8000
        }
      );
      if (res.data?.elements) {
        return res.data.elements;
      }
    } catch (err) {
      console.warn(`[Overpass] ${endpoint} failed: ${err.message}`);
    }
  }
  return [];
}

async function testOverpassCorridor() {
  console.log('--- Testing Google Route + Overpass Corridor ---');

  const source = await geocodeLocation('Morbi');
  const dest = await geocodeLocation('Rajkot');
  console.log('Source:', source);
  console.log('Dest:', dest);

  const routeData = await computeGoogleRoute(source, dest);
  if (!routeData) {
    console.error('Route calculation failed');
    return;
  }

  console.log(`Route Distance: ${routeData.distance_km} km, Duration: ${routeData.duration_minutes} min`);
  console.log(`Polyline points: ${routeData.polylinePoints.length}`);

  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  const points = routeData.polylinePoints;
  const samples = sampleRouteGeometry(points, 5);
  console.log(`Sampled points: ${samples.length}`);

  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }

  const pad = 0.05; // ~5km buffer
  const bbox = `${minLat - pad},${minLon - pad},${maxLat + pad},${maxLon + pad}`;
  console.log(`Overpass BBOX: ${bbox}`);

  const elements = await fetchOverpassNodes(bbox);
  console.log(`Overpass returned ${elements.length} settlement nodes.`);

  const accepted = [];
  for (const el of elements) {
    const name = el.tags?.name || el.tags?.['name:en'];
    const placeType = el.tags?.place;
    if (!name) continue;

    const lat = el.lat;
    const lon = el.lon;

    const proj = projectPointToRoute(lat, lon, routeIndex);
    if (proj.distanceFromRouteKm <= 2.0) {
      accepted.push({
        name,
        placeType,
        lat,
        lon,
        distFromRouteKm: proj.distanceFromRouteKm,
        distFromStartKm: proj.distanceFromStartKm
      });
    }
  }

  accepted.sort((a, b) => a.distFromStartKm - b.distFromStartKm);
  console.log(`Accepted candidates within 2km of route (${accepted.length}):`);
  for (const a of accepted) {
    console.log(` - ${a.name} (${a.placeType}): ${a.distFromStartKm} km from start, ${a.distFromRouteKm} km off route`);
  }
}

testOverpassCorridor();
