const axios = require('axios');
const {
  geocodeLocation,
  computeGoogleRoute,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry,
  getGoogleApiKey
} = require('../src/services/googleRoutesService');

function cleanSettlementName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  let name = rawName.trim();
  name = name.replace(/\b(Taluka|Taluk|District|Tehsil|Tahsil|Sub-District|Subdistrict|Mandalam|County|State|Province|Zone|Municipality|Division)\b/gi, '').trim();
  name = name.replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();
  if (name.length < 2) return null;
  const lower = name.toLowerCase();
  const forbidden = ['india', 'gujarat', 'maharashtra', 'district', 'taluka', 'tehsil', 'division', 'state'];
  if (forbidden.includes(lower)) return null;
  return name;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

async function fetchOverpassBbox(south, west, north, east) {
  const pad = 0.03; // ~3km buffer around chunk bbox
  const bboxStr = `${(south - pad).toFixed(4)},${(west - pad).toFixed(4)},${(north + pad).toFixed(4)},${(east + pad).toFixed(4)}`;
  const query = `[out:json][timeout:8];node["place"~"city|town|village|municipality"](${bboxStr});out body;`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await axios.post(endpoint, `data=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'WeatherGPT-App/1.0 (sih-hackathon@weathergpt.io)'
        },
        timeout: 6000
      });
      if (res.data?.elements) {
        return res.data.elements.map(el => ({
          name: cleanSettlementName(el.tags?.name || el.tags?.['name:en']),
          rawName: el.tags?.name,
          lat: el.lat,
          lon: el.lon,
          placeType: el.tags?.place || 'village',
          source: 'overpass'
        })).filter(e => e.name);
      }
    } catch (err) {
      console.warn(`[Overpass] ${endpoint} failed for bbox [${bboxStr}]: ${err.message}`);
    }
  }
  return [];
}

/**
 * Divide route into 100km corridor chunks and query Overpass concurrently
 */
async function discoverCorridorSettlements(polylinePoints, routeIndex) {
  if (!Array.isArray(polylinePoints) || polylinePoints.length < 2) return [];

  // Split polyline points into ~100km segments
  const chunks = [];
  let currentChunk = [polylinePoints[0]];
  let chunkDist = 0;

  for (let i = 1; i < polylinePoints.length; i++) {
    const prev = polylinePoints[i - 1];
    const curr = polylinePoints[i];
    const dx = curr.longitude - prev.longitude;
    const dy = curr.latitude - prev.latitude;
    const dist = Math.sqrt(dx * dx + dy * dy) * 111; // Approx km

    chunkDist += dist;
    currentChunk.push(curr);

    if (chunkDist >= 100 || i === polylinePoints.length - 1) {
      chunks.push(currentChunk);
      currentChunk = [curr];
      chunkDist = 0;
    }
  }

  console.log(`[Corridor] Route divided into ${chunks.length} corridor chunks.`);

  // For each chunk, calculate BBOX
  const bboxTasks = chunks.map(chunk => {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const p of chunk) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLon) minLon = p.longitude;
      if (p.longitude > maxLon) maxLon = p.longitude;
    }
    return fetchOverpassBbox(minLat, minLon, maxLat, maxLon);
  });

  const chunkResults = await Promise.all(bboxTasks);
  const allCandidates = chunkResults.flat();
  console.log(`[Corridor] Total raw Overpass candidates discovered: ${allCandidates.length}`);
  return allCandidates;
}

async function testRoute(sourceName, destName) {
  console.log(`\n==================================================`);
  console.log(`TESTING ROUTE: ${sourceName} -> ${destName}`);
  console.log(`==================================================`);

  const t0 = Date.now();
  const sourceInfo = await geocodeLocation(sourceName);
  const destInfo = await geocodeLocation(destName);
  const routeData = await computeGoogleRoute(sourceInfo, destInfo);

  if (!routeData) {
    console.error('Route computation failed!');
    return;
  }

  console.log(`1. Google Route Distance: ${routeData.distance_km} km (${routeData.duration_minutes} min)`);
  console.log(`2. Decoded polyline points: ${routeData.polylinePoints.length}`);

  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // Discover candidates from Overpass Corridor
  const candidates = await discoverCorridorSettlements(routeData.polylinePoints, routeIndex);

  // Validate perpendicular distance to actual Google route line segments
  const maxDistKm = Number(process.env.ROUTE_PLACE_MAX_DISTANCE_KM) || 2;
  const totalDistKm = routeData.distance_km;
  const marginKm = Math.min(8.0, totalDistKm * 0.05);

  const sourceNorm = sourceInfo.name.toLowerCase().trim();
  const destNorm = destInfo.name.toLowerCase().trim();
  const acceptedMap = new Map();

  console.log(`\n--- Candidate Filtering Logs ---`);
  for (const cand of candidates) {
    const proj = projectPointToRoute(cand.lat, cand.lon, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distFromStart = proj.distanceFromStartKm;
    const nameNorm = cand.name.toLowerCase().trim();

    if (distFromRoute > maxDistKm) {
      console.log(`[Candidate] ${cand.name} (${cand.placeType}) @ (${cand.lat.toFixed(4)}, ${cand.lon.toFixed(4)}) - Dist to route: ${distFromRoute} km -> REJECTED (> ${maxDistKm} km)`);
      continue;
    }

    if (distFromStart < marginKm || (totalDistKm - distFromStart) < marginKm) {
      console.log(`[Candidate] ${cand.name} (${cand.placeType}) - Dist from start: ${distFromStart} km -> REJECTED (within margin ${marginKm} km)`);
      continue;
    }

    if (nameNorm === sourceNorm || nameNorm === destNorm || sourceNorm.includes(nameNorm) || destNorm.includes(nameNorm)) {
      console.log(`[Candidate] ${cand.name} -> REJECTED (matches source/dest)`);
      continue;
    }

    console.log(`[Candidate] ${cand.name} (${cand.placeType}) @ (${cand.lat.toFixed(4)}, ${cand.lon.toFixed(4)}) - Dist to route: ${distFromRoute} km, Dist from start: ${distFromStart} km -> ACCEPTED`);

    if (!acceptedMap.has(nameNorm)) {
      acceptedMap.set(nameNorm, {
        name: cand.name,
        type: 'route_place',
        latitude: cand.lat,
        longitude: cand.lon,
        distance_from_start_km: distFromStart,
        distanceFromRouteKm: distFromRoute,
        placeType: cand.placeType,
        typeRank: cand.placeType === 'city' ? 1 : (cand.placeType === 'town' ? 2 : 3)
      });
    }
  }

  const rawAccepted = Array.from(acceptedMap.values()).sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);
  console.log(`\nTotal Accepted Settlement Candidates within 2km: ${rawAccepted.length}`);

  // Spacing out (MIN_PLACE_SPACING_KM = 10 km)
  const minSpacingKm = Number(process.env.MIN_PLACE_SPACING_KM) || 10;
  const maxPlaces = Number(process.env.MAX_INTERMEDIATE_PLACES) || 10;

  const spaced = [];
  for (const p of rawAccepted) {
    const nearbyIdx = spaced.findIndex(x => Math.abs(x.distance_from_start_km - p.distance_from_start_km) < minSpacingKm);
    if (nearbyIdx !== -1) {
      if (p.typeRank < spaced[nearbyIdx].typeRank) {
        spaced[nearbyIdx] = p;
      }
    } else {
      spaced.push(p);
    }
  }

  spaced.sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);

  let selected = spaced;
  if (selected.length > maxPlaces) {
    const step = selected.length / maxPlaces;
    const subset = [];
    for (let i = 0; i < maxPlaces; i++) {
      subset.push(selected[Math.floor(i * step)]);
    }
    selected = subset;
  }

  const finalPlaces = [
    { name: sourceInfo.name, type: 'source', distance_from_start_km: 0 },
    ...selected,
    { name: destInfo.name, type: 'destination', distance_from_start_km: totalDistKm }
  ];

  console.log(`\n==================================================`);
  console.log(`FINAL DISCOVERED ROUTE SEQUENCE (${finalPlaces.length} places) [Time: ${Date.now() - t0} ms]:`);
  console.log(`==================================================`);
  finalPlaces.forEach(p => {
    console.log(` - ${p.name} (${p.type}) | ${p.distance_from_start_km} km`);
  });
}

async function main() {
  await testRoute('Morbi', 'Rajkot');
  await testRoute('Morbi', 'Mumbai');
}

main();
