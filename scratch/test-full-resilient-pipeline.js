require('dotenv').config();
const axios = require('axios');
const {
  geocodeLocation,
  computeGoogleRoute,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry,
  getGoogleApiKey
} = require('../src/services/googleRoutesService');

// Clean administrative words and suffixes
function cleanSettlementName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  let name = rawName.trim();
  name = name.replace(/\b(Taluka|Taluk|District|Tehsil|Tahsil|Sub-District|Subdistrict|Mandalam|County|State|Province|Zone|Municipality|Division)\b/gi, '').trim();
  name = name.replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();
  if (name.length < 2) return null;
  const lower = name.toLowerCase();
  const forbidden = ['india', 'gujarat', 'maharashtra', 'karnataka', 'district', 'taluka', 'tehsil', 'division', 'state'];
  if (forbidden.includes(lower)) return null;
  return name;
}

// Variant/spelling normalization check (e.g. Morvi vs Morbi)
function isSameOrVariant(name1, name2) {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().trim().replace(/v/g, 'b');
  const n2 = name2.toLowerCase().trim().replace(/v/g, 'b');
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;
  return false;
}

// 1. BigDataCloud Reverse Geocode
async function reverseGeocodeBigDataCloud(lat, lon) {
  try {
    const res = await axios.get('https://api.bigdatacloud.net/data/reverse-geocode-client', {
      params: { latitude: lat, longitude: lon, localityLanguage: 'en' },
      timeout: 2500
    });
    const data = res.data || {};
    const admin = data.localityInfo?.administrative || [];
    const candidates = [];

    for (const item of admin) {
      if (item.order >= 8 && item.name) {
        const cleaned = cleanSettlementName(item.name);
        if (cleaned) {
          candidates.push({
            name: cleaned,
            latitude: lat,
            longitude: lon,
            placeType: item.description?.toLowerCase().includes('city') ? 'city' : (item.description?.toLowerCase().includes('town') ? 'town' : 'village'),
            source: 'bigdatacloud',
            rank: item.order
          });
        }
      }
    }

    if (data.city) {
      const cleaned = cleanSettlementName(data.city);
      if (cleaned) candidates.push({ name: cleaned, latitude: lat, longitude: lon, placeType: 'city', source: 'bigdatacloud', rank: 10 });
    } else if (data.locality) {
      const cleaned = cleanSettlementName(data.locality);
      if (cleaned) candidates.push({ name: cleaned, latitude: lat, longitude: lon, placeType: 'town', source: 'bigdatacloud', rank: 9 });
    }

    return candidates;
  } catch (err) {
    return [];
  }
}

// 2. Google Geocode (with status check fallback)
async function reverseGeocodeGoogle(lat, lon) {
  const apiKey = getGoogleApiKey();
  if (!apiKey) return [];

  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { latlng: `${lat},${lon}`, key: apiKey },
      timeout: 2500
    });

    if (res.data?.status !== 'OK' || !Array.isArray(res.data?.results)) {
      return [];
    }

    const candidates = [];
    for (const result of res.data.results) {
      const comps = result.address_components || [];
      for (const c of comps) {
        const types = c.types || [];
        if (types.includes('locality') || types.includes('postal_town') ||
            types.includes('sublocality') || types.includes('administrative_area_level_3')) {
          const cleaned = cleanSettlementName(c.long_name);
          if (cleaned) {
            const loc = result.geometry?.location || { lat, lng: lon };
            candidates.push({
              name: cleaned,
              latitude: Number(loc.lat),
              longitude: Number(loc.lng),
              placeType: types.includes('locality') ? 'city' : 'town',
              source: 'google_geocode',
              rank: types.includes('locality') ? 10 : 8
            });
          }
        }
      }
    }
    return candidates;
  } catch (err) {
    return [];
  }
}

// 3. Overpass Corridor Search
async function queryOverpassCorridor(polylinePoints) {
  if (!Array.isArray(polylinePoints) || polylinePoints.length < 2) return [];

  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of polylinePoints) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }

  const pad = 0.03;
  const bbox = `${(minLat - pad).toFixed(4)},${(minLon - pad).toFixed(4)},${(maxLat + pad).toFixed(4)},${(maxLon + pad).toFixed(4)}`;
  const query = `[out:json][timeout:3];node["place"~"city|town|village|municipality"](${bbox});out body;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];

  for (const ep of endpoints) {
    try {
      const res = await axios.post(ep, `data=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)'
        },
        timeout: 3000
      });
      if (res.data?.elements) {
        return res.data.elements.map(el => {
          const cleaned = cleanSettlementName(el.tags?.name || el.tags?.['name:en']);
          if (!cleaned) return null;
          return {
            name: cleaned,
            latitude: el.lat,
            longitude: el.lon,
            placeType: el.tags?.place || 'village',
            source: 'overpass',
            rank: el.tags?.place === 'city' ? 10 : (el.tags?.place === 'town' ? 8 : 6)
          };
        }).filter(Boolean);
      }
    } catch (err) {}
  }
  return [];
}

async function runResilientRoutePipeline(sourceQuery, destQuery) {
  console.log(`\n==================================================`);
  console.log(`PIPELINE TEST: ${sourceQuery} -> ${destQuery}`);
  console.log(`==================================================`);

  const tStart = Date.now();

  // STEP 1: Geocode Source and Destination
  const sourceInfo = await geocodeLocation(sourceQuery);
  const destInfo = await geocodeLocation(destQuery);

  if (!sourceInfo || !destInfo) {
    console.error('Source or destination geocode failed');
    return;
  }

  console.log(`Source: ${sourceInfo.name} (${sourceInfo.latitude}, ${sourceInfo.longitude})`);
  console.log(`Dest: ${destInfo.name} (${destInfo.latitude}, ${destInfo.longitude})`);

  // STEP 2: Compute Driving Route
  const routeData = await computeGoogleRoute(sourceInfo, destInfo);
  if (!routeData) {
    console.error('Driving route computation failed');
    return;
  }

  console.log(`\n1. Driving Route Distance: ${routeData.distance_km} km`);
  console.log(`2. Estimated Duration: ${routeData.duration_minutes} min`);
  console.log(`3. Decoded Polyline Points: ${routeData.polylinePoints.length}`);

  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // STEP 3: Sample Route Geometry
  const sampleDistKm = routeData.distance_km < 100 ? 5 : (routeData.distance_km < 400 ? 10 : 15);
  const sampledCoords = sampleRouteGeometry(routeData.polylinePoints, sampleDistKm);
  console.log(`4. Sampled Checkpoints: ${sampledCoords.length} (spacing: ~${sampleDistKm} km)`);

  // STEP 4: Parallel Multi-Source Discovery
  console.log('5. Running Multi-Source Discovery (BigDataCloud + Google + Overpass)...');
  const tDiscoveryStart = Date.now();

  const [bdcResults, googleResults, overpassResults] = await Promise.all([
    Promise.all(sampledCoords.map(s => reverseGeocodeBigDataCloud(s.latitude, s.longitude))),
    Promise.all(sampledCoords.map(s => reverseGeocodeGoogle(s.latitude, s.longitude))),
    queryOverpassCorridor(routeData.polylinePoints)
  ]);

  const tDiscoveryMs = Date.now() - tDiscoveryStart;
  const rawCandidates = [
    ...bdcResults.flat(),
    ...googleResults.flat(),
    ...overpassResults
  ];

  console.log(`   Multi-Source Discovery finished in ${tDiscoveryMs} ms. Raw candidates count: ${rawCandidates.length}`);

  // STEP 5: Perpendicular Distance & Boundary Filtering
  const maxPlaceDistanceKm = Number(process.env.ROUTE_PLACE_MAX_DISTANCE_KM) || 2;
  const totalDistKm = routeData.distance_km;
  const marginKm = Math.min(8.0, totalDistKm * 0.05);

  const sourceNorm = sourceInfo.name;
  const destNorm = destInfo.name;

  const acceptedMap = new Map();
  let candidateLogsCount = 0;

  console.log(`\n--- Candidate Evaluation Detailed Logs ---`);
  for (const cand of rawCandidates) {
    const proj = projectPointToRoute(cand.latitude, cand.longitude, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distFromStart = proj.distanceFromStartKm;
    const nameKey = cand.name.toLowerCase().trim();

    if (candidateLogsCount < 12) {
      console.log(`[Sample Candidate] Name: ${cand.name}, Coords: (${cand.latitude.toFixed(4)}, ${cand.longitude.toFixed(4)}), DistToRoute: ${distFromRoute} km, DistFromStart: ${distFromStart} km, Source: ${cand.source}`);
      candidateLogsCount++;
    }

    if (distFromRoute > maxPlaceDistanceKm) continue;
    if (distFromStart < marginKm || (totalDistKm - distFromStart) < marginKm) continue;

    if (isSameOrVariant(cand.name, sourceNorm) || isSameOrVariant(cand.name, destNorm)) {
      continue;
    }

    if (!acceptedMap.has(nameKey) || cand.rank > acceptedMap.get(nameKey).rank) {
      acceptedMap.set(nameKey, {
        name: cand.name,
        type: 'route_place',
        latitude: cand.latitude,
        longitude: cand.longitude,
        distance_from_start_km: distFromStart,
        distanceFromRouteKm: distFromRoute,
        placeType: cand.placeType,
        rank: cand.rank,
        source: cand.source
      });
    }
  }

  const rawAccepted = Array.from(acceptedMap.values()).sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);
  console.log(`\n6. Total Accepted Candidates within 2km of route: ${rawAccepted.length}`);

  // STEP 6: Spacing & Ranking
  const minSpacingKm = Number(process.env.MIN_PLACE_SPACING_KM) || 10;
  const maxPlaces = Number(process.env.MAX_INTERMEDIATE_PLACES) || 10;

  const spaced = [];
  for (const place of rawAccepted) {
    const nearbyIdx = spaced.findIndex(x => Math.abs(x.distance_from_start_km - place.distance_from_start_km) < minSpacingKm);
    if (nearbyIdx !== -1) {
      if (place.rank > spaced[nearbyIdx].rank) {
        spaced[nearbyIdx] = place;
      }
    } else {
      spaced.push(place);
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
  console.log(`FINAL ROUTE PLACES SEQUENCE (${finalSequence.length} places) [Total Execution Time: ${Date.now() - tStart} ms]:`);
  console.log(`==================================================`);
  finalSequence.forEach(p => {
    console.log(` -> ${p.name} (${p.type}) | ${p.distance_from_start_km} km ${p.source ? `[via ${p.source}]` : ''}`);
  });
}

async function main() {
  await runResilientRoutePipeline('Morbi', 'Rajkot');
  await runResilientRoutePipeline('Morbi', 'Mumbai');
  await runResilientRoutePipeline('Ahmedabad', 'Surat');
}

main();
