const axios = require('axios');
const { geocodeLocation, computeGoogleRoute, sampleRouteGeometry, buildRouteIndex, projectPointToRoute } = require('../src/services/googleRoutesService');

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

async function reverseGeocodeSampleDetailed(lat, lon) {
  try {
    const res = await axios.get('https://api.bigdatacloud.net/data/reverse-geocode-client', {
      params: { latitude: lat, longitude: lon, localityLanguage: 'en' },
      timeout: 3000
    });

    const data = res.data || {};
    const admin = data.localityInfo?.administrative || [];

    const candidates = [];

    // Check all admin components from order 12 down to 8
    for (const item of admin) {
      if (item.order >= 8 && item.name) {
        const cleaned = cleanSettlementName(item.name);
        if (cleaned) {
          candidates.push({
            name: cleaned,
            order: item.order,
            description: item.description
          });
        }
      }
    }

    if (data.locality) {
      const cleaned = cleanSettlementName(data.locality);
      if (cleaned) candidates.push({ name: cleaned, order: 12 });
    }

    if (data.city) {
      const cleaned = cleanSettlementName(data.city);
      if (cleaned) candidates.push({ name: cleaned, order: 10 });
    }

    return candidates;
  } catch (err) {
    return [];
  }
}

async function testMorbiRajkotFine() {
  console.log(`\n==================================================`);
  console.log(`TESTING FINE-GRAINED DISCOVERY: Morbi -> Rajkot`);
  console.log(`==================================================`);

  const t0 = Date.now();
  const sourceInfo = await geocodeLocation('Morbi');
  const destInfo = await geocodeLocation('Rajkot');
  const routeData = await computeGoogleRoute(sourceInfo, destInfo);

  if (!routeData) {
    console.error('Route calculation failed');
    return;
  }

  console.log(`1. Driving Route Distance: ${routeData.distance_km} km (${routeData.duration_minutes} min)`);
  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // Sample every 4 km for shorter route
  const samples = sampleRouteGeometry(routeData.polylinePoints, 4);
  console.log(`2. Sampled checkpoints count: ${samples.length}`);

  const rawCandidates = [];
  const tasks = samples.map(async (s) => {
    const list = await reverseGeocodeSampleDetailed(s.latitude, s.longitude);
    list.forEach(item => {
      rawCandidates.push({
        name: item.name,
        latitude: s.latitude,
        longitude: s.longitude,
        order: item.order,
        description: item.description
      });
    });
  });

  await Promise.all(tasks);
  console.log(`3. Total raw candidates fetched: ${rawCandidates.length}`);

  const maxDistKm = 2.0;
  const totalDistKm = routeData.distance_km;
  const marginKm = Math.min(8.0, totalDistKm * 0.05);

  const sourceNorm = sourceInfo.name.toLowerCase().trim();
  const destNorm = destInfo.name.toLowerCase().trim();
  const acceptedMap = new Map();

  for (const cand of rawCandidates) {
    const proj = projectPointToRoute(cand.latitude, cand.longitude, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distFromStart = proj.distanceFromStartKm;
    const nameNorm = cand.name.toLowerCase().trim();

    if (distFromRoute > maxDistKm) continue;
    if (distFromStart < marginKm || (totalDistKm - distFromStart) < marginKm) continue;

    if (nameNorm === sourceNorm || nameNorm === destNorm || sourceNorm.includes(nameNorm) || destNorm.includes(nameNorm)) {
      continue;
    }

    if (!acceptedMap.has(nameNorm)) {
      acceptedMap.set(nameNorm, {
        name: cand.name,
        type: 'route_place',
        latitude: cand.latitude,
        longitude: cand.longitude,
        distance_from_start_km: distFromStart,
        distanceFromRouteKm: distFromRoute,
        order: cand.order
      });
    }
  }

  const rawAccepted = Array.from(acceptedMap.values()).sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);
  console.log(`\n4. Total Accepted Settlement Candidates within 2km: ${rawAccepted.length}`);

  const minSpacingKm = 8;
  const maxPlaces = 10;

  const spaced = [];
  for (const p of rawAccepted) {
    const nearbyIdx = spaced.findIndex(x => Math.abs(x.distance_from_start_km - p.distance_from_start_km) < minSpacingKm);
    if (nearbyIdx !== -1) {
      if ((p.order || 0) > (spaced[nearbyIdx].order || 0)) {
        spaced[nearbyIdx] = p;
      }
    } else {
      spaced.push(p);
    }
  }

  spaced.sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);

  const finalPlaces = [
    { name: sourceInfo.name, type: 'source', distance_from_start_km: 0 },
    ...spaced,
    { name: destInfo.name, type: 'destination', distance_from_start_km: totalDistKm }
  ];

  console.log(`\n==================================================`);
  console.log(`FINAL ROUTE SEQUENCE (${finalPlaces.length} places) [Execution Time: ${Date.now() - t0} ms]:`);
  console.log(`==================================================`);
  finalPlaces.forEach(p => {
    console.log(` - ${p.name} (${p.type}) | ${p.distance_from_start_km} km`);
  });
}

testMorbiRajkotFine();
