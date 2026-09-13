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

async function reverseGeocodeBigDataCloud(lat, lon) {
  try {
    const res = await axios.get('https://api.bigdatacloud.net/data/reverse-geocode-client', {
      params: { latitude: lat, longitude: lon, localityLanguage: 'en' },
      timeout: 3000
    });

    const data = res.data || {};
    const admin = data.localityInfo?.administrative || [];

    // Search administrative components from order 10 down to 7 (highest detail to town/city level)
    let candidateName = null;
    let placeType = 'town';

    for (const item of admin) {
      if (item.order >= 9 && item.name) {
        const cleaned = cleanSettlementName(item.name);
        if (cleaned) {
          candidateName = cleaned;
          if (item.description && item.description.toLowerCase().includes('city')) {
            placeType = 'city';
          }
          break;
        }
      }
    }

    if (!candidateName && data.city) {
      candidateName = cleanSettlementName(data.city);
      placeType = 'city';
    } else if (!candidateName && data.locality) {
      candidateName = cleanSettlementName(data.locality);
    }

    if (candidateName) {
      return {
        name: candidateName,
        latitude: lat,
        longitude: lon,
        placeType,
        source: 'bigdatacloud'
      };
    }
  } catch (err) {
    // Ignore error
  }
  return null;
}

async function testFullRoute(sourceQuery, destQuery) {
  console.log(`\n==================================================`);
  console.log(`TESTING ROUTE DISCOVERY: ${sourceQuery} -> ${destQuery}`);
  console.log(`==================================================`);

  const t0 = Date.now();
  const sourceInfo = await geocodeLocation(sourceQuery);
  const destInfo = await geocodeLocation(destQuery);
  const routeData = await computeGoogleRoute(sourceInfo, destInfo);

  if (!routeData) {
    console.error('Route calculation failed');
    return;
  }

  console.log(`1. Driving Route Distance: ${routeData.distance_km} km (${routeData.duration_minutes} min)`);
  console.log(`2. Decoded Polyline points: ${routeData.polylinePoints.length}`);

  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // Sample route points every 12 km
  const samples = sampleRouteGeometry(routeData.polylinePoints, 12);
  console.log(`3. Sampled checkpoints count: ${samples.length}`);

  // Fetch reverse geocode for each sample
  console.log('4. Reverse geocoding sampled checkpoints via BigDataCloud...');
  const revGeoTasks = samples.map(s => reverseGeocodeBigDataCloud(s.latitude, s.longitude));
  const rawCandidates = (await Promise.all(revGeoTasks)).filter(Boolean);

  console.log(`5. Discovered ${rawCandidates.length} raw candidate settlements.`);

  // Filter based on perpendicular distance to Google route polyline line segments
  const maxDistKm = Number(process.env.ROUTE_PLACE_MAX_DISTANCE_KM) || 2;
  const totalDistKm = routeData.distance_km;
  const marginKm = Math.min(8.0, totalDistKm * 0.05);

  const sourceNorm = sourceInfo.name.toLowerCase().trim();
  const destNorm = destInfo.name.toLowerCase().trim();
  const acceptedMap = new Map();

  console.log(`\n--- Candidate Filtering Logs ---`);
  for (const cand of rawCandidates) {
    const proj = projectPointToRoute(cand.latitude, cand.longitude, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distFromStart = proj.distanceFromStartKm;
    const nameNorm = cand.name.toLowerCase().trim();

    if (distFromRoute > maxDistKm) {
      console.log(`[Candidate] ${cand.name} - Dist to route: ${distFromRoute} km -> REJECTED (> ${maxDistKm} km)`);
      continue;
    }

    if (distFromStart < marginKm || (totalDistKm - distFromStart) < marginKm) {
      console.log(`[Candidate] ${cand.name} - Dist from start: ${distFromStart} km -> REJECTED (within margin ${marginKm} km)`);
      continue;
    }

    if (nameNorm === sourceNorm || nameNorm === destNorm || sourceNorm.includes(nameNorm) || destNorm.includes(nameNorm)) {
      console.log(`[Candidate] ${cand.name} -> REJECTED (matches source/dest)`);
      continue;
    }

    console.log(`[Candidate] ${cand.name} (${cand.placeType}) @ ${distFromStart} km (off route by ${distFromRoute} km) -> ACCEPTED`);

    if (!acceptedMap.has(nameNorm)) {
      acceptedMap.set(nameNorm, {
        name: cand.name,
        type: 'route_place',
        latitude: cand.latitude,
        longitude: cand.longitude,
        distance_from_start_km: distFromStart,
        distanceFromRouteKm: distFromRoute,
        placeType: cand.placeType,
        typeRank: cand.placeType === 'city' ? 1 : 2
      });
    }
  }

  const rawAccepted = Array.from(acceptedMap.values()).sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);
  console.log(`\nTotal Accepted Settlement Candidates within 2km: ${rawAccepted.length}`);

  // Spacing (MIN_PLACE_SPACING_KM = 10 km, MAX_INTERMEDIATE_PLACES = 10)
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
  console.log(`FINAL ROUTE SEQUENCE (${finalPlaces.length} places) [Execution Time: ${Date.now() - t0} ms]:`);
  console.log(`==================================================`);
  finalPlaces.forEach(p => {
    console.log(` - ${p.name} (${p.type}) | ${p.distance_from_start_km} km`);
  });
}

async function main() {
  await testFullRoute('Morbi', 'Rajkot');
  await testFullRoute('Morbi', 'Mumbai');
}

main();
