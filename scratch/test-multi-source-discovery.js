const axios = require('axios');
const {
  geocodeLocation,
  computeGoogleRoute,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry,
  getGoogleApiKey
} = require('../src/services/googleRoutesService');

function cleanAdministrativeName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  let name = rawName.trim();
  name = name.replace(/\b(Taluka|Taluk|District|Tehsil|Tahsil|Sub-District|Subdistrict|Mandalam|County|State|Province|Zone|Municipality)\b/gi, '').trim();
  name = name.replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();
  if (name.length < 2) return null;
  return name;
}

async function mapWithConcurrency(items, concurrencyLimit, asyncFn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await asyncFn(items[i], i);
      } catch (err) {
        results[i] = null;
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrencyLimit, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// Reverse Geocoding with fallback
async function reverseGeocodeSample(lat, lon) {
  const apiKey = getGoogleApiKey();
  const results = [];

  // A. Google Geocoding
  if (apiKey) {
    try {
      const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: {
          latlng: `${lat},${lon}`,
          key: apiKey,
          result_type: 'locality|sublocality|administrative_area_level_3|administrative_area_level_2|postal_town'
        },
        timeout: 2500
      });
      if (res.data?.results) {
        for (const item of res.data.results) {
          const comps = item.address_components || [];
          for (const c of comps) {
            const types = c.types || [];
            if (types.includes('locality') || types.includes('postal_town') ||
                types.includes('sublocality') || types.includes('sublocality_level_1') ||
                types.includes('administrative_area_level_3') || types.includes('administrative_area_level_2')) {
              const cleaned = cleanAdministrativeName(c.long_name);
              if (cleaned) {
                const itemLat = item.geometry?.location?.lat || lat;
                const itemLon = item.geometry?.location?.lng || lon;
                results.push({ name: cleaned, lat: itemLat, lon: itemLon, source: 'google_geocode', type: types[0] });
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  // B. Nominatim
  try {
    const nomRes = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json', zoom: 14, addressdetails: 1 },
      headers: { 'User-Agent': 'WeatherGPT-App/1.0 (sih-hackathon@weathergpt.io)' },
      timeout: 2500
    });
    const addr = nomRes.data?.address || {};
    const candidateName = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.locality;
    if (candidateName) {
      const cleaned = cleanAdministrativeName(candidateName);
      if (cleaned) {
        const itemLat = Number(nomRes.data.lat || lat);
        const itemLon = Number(nomRes.data.lon || lon);
        results.push({ name: cleaned, lat: itemLat, lon: itemLon, source: 'nominatim', type: addr.city ? 'city' : (addr.town ? 'town' : 'village') });
      }
    }
  } catch (e) {}

  // C. Photon
  try {
    const photoRes = await axios.get('https://photon.komoot.io/reverse', {
      params: { lat, lon },
      timeout: 2500
    });
    const feats = photoRes.data?.features || [];
    for (const f of feats) {
      const props = f.properties || {};
      const candidateName = props.city || props.town || props.village || props.locality || props.district || props.name;
      if (candidateName) {
        const cleaned = cleanAdministrativeName(candidateName);
        if (cleaned) {
          const coords = f.geometry?.coordinates || [lon, lat];
          results.push({ name: cleaned, lat: coords[1], lon: coords[0], source: 'photon', type: props.type || 'settlement' });
        }
      }
    }
  } catch (e) {}

  return results;
}

// Fast BBOX Overpass Query with 3s timeout
async function queryOverpassSettlements(bbox) {
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
      return (res.data?.elements || []).map(el => ({
        name: cleanAdministrativeName(el.tags?.name || el.tags?.['name:en']),
        lat: el.lat,
        lon: el.lon,
        type: el.tags?.place || 'village',
        source: 'overpass'
      })).filter(e => e.name);
    } catch (err) {}
  }
  return [];
}

async function testFullDiscovery(sourceName, destName) {
  console.log(`\n==================================================`);
  console.log(`FULL MULTI-SOURCE DISCOVERY: ${sourceName} -> ${destName}`);
  console.log(`==================================================`);

  const t0 = Date.now();
  const sourceInfo = await geocodeLocation(sourceName);
  const destInfo = await geocodeLocation(destName);
  const routeData = await computeGoogleRoute(sourceInfo, destInfo);

  if (!routeData) {
    console.error('Route computation failed!');
    return;
  }

  console.log(`1. Route Distance: ${routeData.distance_km} km`);
  console.log(`2. Decoded polyline points: ${routeData.polylinePoints.length}`);

  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // Sample route points every 5 km
  const samples = sampleRouteGeometry(routeData.polylinePoints, 5);
  console.log(`3. Sampled points count: ${samples.length}`);

  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of routeData.polylinePoints) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }
  const pad = 0.03;
  const bbox = `${minLat - pad},${minLon - pad},${maxLat + pad},${maxLon + pad}`;

  // Execute Overpass AND Reverse Geocoding in PARALLEL via Promise.all
  console.log('4. Fetching candidates from Overpass + Reverse Geocoding in parallel...');
  const [overpassPlaces, revGeoBatches] = await Promise.all([
    queryOverpassSettlements(bbox),
    mapWithConcurrency(samples, 4, (s) => reverseGeocodeSample(s.latitude, s.longitude))
  ]);

  const revGeoCandidates = revGeoBatches.flat().filter(Boolean);
  console.log(`   Overpass places: ${overpassPlaces.length} | Reverse geocode candidates: ${revGeoCandidates.length}`);

  const allCandidates = [...overpassPlaces, ...revGeoCandidates];
  console.log(`5. Combined raw candidates: ${allCandidates.length}`);

  // D. Filter & Validate Distance to Route Polyline Line Segments
  const acceptedMap = new Map();
  const sourceNorm = sourceInfo.name.toLowerCase().trim();
  const destNorm = destInfo.name.toLowerCase().trim();
  const totalDist = routeData.distance_km;
  const marginKm = Math.min(8.0, totalDist * 0.05);

  for (const cand of allCandidates) {
    const proj = projectPointToRoute(cand.lat, cand.lon, routeIndex);

    // Reject candidates > 2 km from route
    if (proj.distanceFromRouteKm > 2.0) continue;

    // Reject candidates within margin of start/end
    if (proj.distanceFromStartKm < marginKm || (totalDist - proj.distanceFromStartKm) < marginKm) continue;

    const normName = cand.name.toLowerCase().trim();
    if (normName === sourceNorm || normName === destNorm) continue;
    if (sourceNorm.includes(normName) || destNorm.includes(normName)) continue;

    if (!acceptedMap.has(normName)) {
      acceptedMap.set(normName, {
        name: cand.name,
        type: cand.type,
        latitude: cand.lat,
        longitude: cand.lon,
        distanceFromRouteKm: proj.distanceFromRouteKm,
        distanceFromStartKm: proj.distanceFromStartKm,
        typeRank: cand.type === 'city' ? 1 : (cand.type === 'town' ? 2 : 3),
        source: cand.source
      });
    }
  }

  const rawAccepted = Array.from(acceptedMap.values()).sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm);
  console.log(`6. Candidates within 2km of route: ${rawAccepted.length}`);

  // E. Spacing & Ranking (MIN_PLACE_SPACING_KM = 10 km, MAX_INTERMEDIATE_PLACES = 10)
  const minSpacingKm = 10;
  const maxPlaces = 10;
  const spacedPlaces = [];

  for (const place of rawAccepted) {
    const nearbyIdx = spacedPlaces.findIndex(p => Math.abs(p.distanceFromStartKm - place.distanceFromStartKm) < minSpacingKm);
    if (nearbyIdx !== -1) {
      if (place.typeRank < spacedPlaces[nearbyIdx].typeRank) {
        spacedPlaces[nearbyIdx] = place;
      }
    } else {
      spacedPlaces.push(place);
    }
  }

  spacedPlaces.sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm);

  let finalPlaces = spacedPlaces;
  if (finalPlaces.length > maxPlaces) {
    const step = finalPlaces.length / maxPlaces;
    const subset = [];
    for (let i = 0; i < maxPlaces; i++) {
      subset.push(finalPlaces[Math.floor(i * step)]);
    }
    finalPlaces = subset;
  }

  console.log(`\n==================================================`);
  console.log(`FINAL DISCOVERED INTERMEDIATE PLACES (${finalPlaces.length}) [Execution Time: ${Date.now() - t0} ms]:`);
  console.log(`==================================================`);
  console.log(`0 km: ${sourceInfo.name} [SOURCE]`);
  finalPlaces.forEach(p => {
    console.log(`${p.distanceFromStartKm} km: ${p.name} (${p.type}) [off route: ${p.distanceFromRouteKm} km, via ${p.source}]`);
  });
  console.log(`${totalDist} km: ${destInfo.name} [DESTINATION]`);
}

async function main() {
  await testFullDiscovery('Morbi', 'Rajkot');
  await testFullDiscovery('Morbi', 'Mumbai');
}

main();
