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

  // Strip administrative words
  name = name.replace(/\b(Taluka|Taluk|District|Tehsil|Tahsil|Sub-District|Subdistrict|Mandalam|County|State|Province|Zone|Municipality|Division)\b/gi, '').trim();
  name = name.replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();

  if (name.length < 2) return null;
  // Reject pure administrative or country/state names
  const lower = name.toLowerCase();
  const forbidden = ['india', 'gujarat', 'maharashtra', 'district', 'taluka', 'tehsil', 'division', 'state'];
  if (forbidden.includes(lower)) return null;

  return name;
}

// Reverse Geocode a sample coordinate using Photon + Google + Nominatim
async function reverseGeocodeSampleFast(lat, lon) {
  const apiKey = getGoogleApiKey();
  const candidates = [];

  // 1. Google Geocoding API if key configured
  if (apiKey) {
    try {
      const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: {
          latlng: `${lat},${lon}`,
          key: apiKey,
          result_type: 'locality|sublocality|administrative_area_level_3|postal_town'
        },
        timeout: 2500
      });
      const results = res.data?.results || [];
      for (const item of results) {
        const comps = item.address_components || [];
        for (const c of comps) {
          const types = c.types || [];
          if (types.includes('locality') || types.includes('postal_town') ||
              types.includes('sublocality') || types.includes('sublocality_level_1') ||
              types.includes('administrative_area_level_3')) {
            const cleaned = cleanSettlementName(c.long_name);
            if (cleaned) {
              const loc = item.geometry?.location || { lat, lng: lon };
              candidates.push({
                name: cleaned,
                latitude: Number(loc.lat),
                longitude: Number(loc.lng),
                placeType: types.includes('locality') ? 'city' : (types.includes('postal_town') ? 'town' : 'village'),
                source: 'google_geocode'
              });
            }
          }
        }
      }
    } catch (e) {}
  }

  // 2. Photon Reverse Geocoding (Fast, free, no rate-limit issues)
  try {
    const photoRes = await axios.get('https://photon.komoot.io/reverse', {
      params: { lat, lon },
      timeout: 2500
    });
    const feats = photoRes.data?.features || [];
    for (const f of feats) {
      const props = f.properties || {};
      const candidateName = props.city || props.town || props.village || props.locality || props.district || props.name;
      const type = (props.type || '').toLowerCase();
      if (candidateName && ['city', 'town', 'village', 'locality', 'district'].includes(type)) {
        const cleaned = cleanSettlementName(candidateName);
        if (cleaned) {
          const coords = f.geometry?.coordinates || [lon, lat];
          candidates.push({
            name: cleaned,
            latitude: Number(coords[1]),
            longitude: Number(coords[0]),
            placeType: type === 'city' ? 'city' : (type === 'town' ? 'town' : 'village'),
            source: 'photon'
          });
        }
      }
    }
  } catch (e) {}

  return candidates;
}

async function testFastPipeline(sourceQuery, destQuery) {
  console.log(`\n==================================================`);
  console.log(`FAST DISCOVERY PIPELINE: ${sourceQuery} -> ${destQuery}`);
  console.log(`==================================================`);

  const tStart = Date.now();
  const sourceInfo = await geocodeLocation(sourceQuery);
  const destInfo = await geocodeLocation(destQuery);

  if (!sourceInfo || !destInfo) {
    console.error('Failed to geocode source or dest');
    return;
  }

  const routeData = await computeGoogleRoute(sourceInfo, destInfo);
  if (!routeData) {
    console.error('Failed to compute route');
    return;
  }

  console.log(`1. Route Distance: ${routeData.distance_km} km (${routeData.duration_minutes} min)`);
  console.log(`2. Decoded polyline points: ${routeData.polylinePoints.length}`);

  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // Sample route every 6 km
  const samples = sampleRouteGeometry(routeData.polylinePoints, 6);
  console.log(`3. Sampled checkpoints count: ${samples.length}`);

  // Fetch reverse geocodes for samples concurrently with batch size 5
  console.log('4. Reverse geocoding sampled checkpoints...');
  const allCandidates = [];

  for (let i = 0; i < samples.length; i += 5) {
    const chunk = samples.slice(i, i + 5);
    const results = await Promise.all(chunk.map(s => reverseGeocodeSampleFast(s.latitude, s.longitude)));
    results.flat().forEach(c => allCandidates.push(c));
  }

  console.log(`5. Total candidate mentions discovered: ${allCandidates.length}`);

  // Filter candidates based on perpendicular distance to route polyline
  const maxPlaceDistanceKm = Number(process.env.ROUTE_PLACE_MAX_DISTANCE_KM) || 2;
  const sourceNorm = sourceInfo.name.toLowerCase().trim();
  const destNorm = destInfo.name.toLowerCase().trim();
  const totalDistKm = routeData.distance_km;
  const marginKm = Math.min(8.0, totalDistKm * 0.05);

  const acceptedMap = new Map();

  console.log(`\n--- Candidate Filtering Logs ---`);
  for (const cand of allCandidates) {
    const proj = projectPointToRoute(cand.latitude, cand.longitude, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distFromStart = proj.distanceFromStartKm;
    const normName = cand.name.toLowerCase().trim();

    if (distFromRoute > maxPlaceDistanceKm) {
      console.log(`[Candidate] ${cand.name} - Dist to route: ${distFromRoute} km -> REJECTED (> ${maxPlaceDistanceKm} km)`);
      continue;
    }

    if (distFromStart < marginKm || (totalDistKm - distFromStart) < marginKm) {
      console.log(`[Candidate] ${cand.name} - Dist from start: ${distFromStart} km -> REJECTED (within start/end margin ${marginKm} km)`);
      continue;
    }

    if (normName === sourceNorm || normName === destNorm || sourceNorm.includes(normName) || destNorm.includes(normName)) {
      console.log(`[Candidate] ${cand.name} -> REJECTED (matches source/dest)`);
      continue;
    }

    console.log(`[Candidate] ${cand.name} (${cand.placeType}) @ ${distFromStart} km (off route by ${distFromRoute} km) -> ACCEPTED [via ${cand.source}]`);

    if (!acceptedMap.has(normName)) {
      acceptedMap.set(normName, {
        name: cand.name,
        type: 'route_place',
        latitude: cand.latitude,
        longitude: cand.longitude,
        distance_from_start_km: distFromStart,
        distanceFromRouteKm: distFromRoute,
        placeType: cand.placeType,
        typeRank: cand.placeType === 'city' ? 1 : (cand.placeType === 'town' ? 2 : 3),
        source: cand.source
      });
    }
  }

  const acceptedList = Array.from(acceptedMap.values()).sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);
  console.log(`\n6. Total Accepted Settlement Candidates: ${acceptedList.length}`);

  // Spacing (10km minimum spacing)
  const minSpacingKm = Number(process.env.MIN_PLACE_SPACING_KM) || 10;
  const maxPlaces = Number(process.env.MAX_INTERMEDIATE_PLACES) || 10;
  const spaced = [];

  for (const p of acceptedList) {
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

  const finalSequence = [
    { name: sourceInfo.name, type: 'source', distance_from_start_km: 0 },
    ...selected,
    { name: destInfo.name, type: 'destination', distance_from_start_km: totalDistKm }
  ];

  console.log(`\n==================================================`);
  console.log(`FINAL ROUTE SEQUENCE (${finalSequence.length} places) [Execution Time: ${Date.now() - tStart} ms]:`);
  console.log(`==================================================`);
  finalSequence.forEach(p => {
    console.log(` - ${p.name} (${p.type}) | ${p.distance_from_start_km} km`);
  });
}

async function main() {
  await testFastPipeline('Morbi', 'Rajkot');
  await testFastPipeline('Morbi', 'Mumbai');
}

main();
