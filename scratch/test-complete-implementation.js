const axios = require('axios');
const {
  geocodeLocation,
  computeGoogleRoute,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry,
  getGoogleApiKey
} = require('../src/services/googleRoutesService');

// Clean administrative suffixes from candidate settlement names
function cleanSettlementName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  let name = rawName.trim();
  // Strip administrative words
  name = name.replace(/\b(Taluka|Taluk|District|Tehsil|Tahsil|Sub-District|Subdistrict|Mandalam|County|State|Province|Zone|Municipality)\b/gi, '').trim();
  name = name.replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();
  if (name.length < 2) return null;
  return name;
}

// Check if string is purely administrative or non-settlement
function isPureAdministrativeWord(name) {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  const forbidden = ['taluka', 'taluk', 'district', 'tehsil', 'tahsil', 'county', 'state', 'province', 'division', 'region', 'zone', 'india', 'gujarat', 'maharashtra'];
  return forbidden.includes(lower);
}

/**
 * Stage 2: OSM Overpass Geographic Settlement Discovery along Route Corridor
 */
async function discoverOverpassSettlements(polylinePoints, routeIndex, searchRadiusKm = 5) {
  // Sample polyline points every ~8 km for corridor centers
  const samples = sampleRouteGeometry(polylinePoints, 8);
  if (samples.length === 0) return [];

  // Construct around string for Overpass
  const radiusMeters = Math.round(searchRadiusKm * 1000);
  const coordsStr = samples.map(s => `${s.latitude.toFixed(4)},${s.longitude.toFixed(4)}`).join(',');
  const query = `[out:json][timeout:5];(node["place"~"city|town|village|municipality"](around:${radiusMeters},${coordsStr});way["place"~"city|town|village|municipality"](around:${radiusMeters},${coordsStr}););out center;`;

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
        timeout: 4000
      });

      const elements = res.data?.elements || [];
      const candidates = [];

      for (const el of elements) {
        const rawName = el.tags?.name || el.tags?.['name:en'];
        const placeType = el.tags?.place || 'village';
        if (!rawName) continue;

        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;
        if (!lat || !lon) continue;

        const cleanedName = cleanSettlementName(rawName);
        if (!cleanedName || isPureAdministrativeWord(cleanedName)) continue;

        candidates.push({
          name: cleanedName,
          rawName,
          latitude: lat,
          longitude: lon,
          placeType,
          source: 'overpass'
        });
      }
      return candidates;
    } catch (err) {
      // Try next endpoint
    }
  }

  return [];
}

/**
 * Stage 2 Fallback: Reverse Geocode Sampled Route Points
 */
async function reverseGeocodeSamplePoints(samples) {
  const apiKey = getGoogleApiKey();

  // Controlled concurrency map
  const results = [];
  for (const s of samples) {
    let candidate = null;

    if (apiKey) {
      try {
        const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
          params: {
            latlng: `${s.latitude},${s.longitude}`,
            key: apiKey,
            result_type: 'locality|sublocality|administrative_area_level_3|postal_town'
          },
          timeout: 2000
        });

        const first = res.data?.results?.[0];
        if (first) {
          const comps = first.address_components || [];
          const targetComp = comps.find(c =>
            c.types.includes('locality') ||
            c.types.includes('postal_town') ||
            c.types.includes('sublocality') ||
            c.types.includes('administrative_area_level_3')
          );
          if (targetComp) {
            const cleaned = cleanSettlementName(targetComp.long_name);
            if (cleaned && !isPureAdministrativeWord(cleaned)) {
              candidate = {
                name: cleaned,
                latitude: s.latitude,
                longitude: s.longitude,
                placeType: targetComp.types.includes('locality') ? 'city' : 'town',
                source: 'google_geocode'
              };
            }
          }
        }
      } catch (e) {}
    }

    // Photon Fallback
    if (!candidate) {
      try {
        const photoRes = await axios.get('https://photon.komoot.io/reverse', {
          params: { lat: s.latitude, lon: s.longitude },
          timeout: 1500
        });
        const feat = photoRes.data?.features?.[0];
        if (feat) {
          const props = feat.properties || {};
          const rawName = props.city || props.town || props.village || props.locality || props.name;
          const cleaned = cleanSettlementName(rawName);
          if (cleaned && !isPureAdministrativeWord(cleaned)) {
            const coords = feat.geometry?.coordinates || [s.longitude, s.latitude];
            candidate = {
              name: cleaned,
              latitude: coords[1],
              longitude: coords[0],
              placeType: props.type || 'town',
              source: 'photon'
            };
          }
        }
      } catch (e) {}
    }

    if (candidate) {
      results.push(candidate);
    }
  }

  return results;
}

/**
 * Core Algorithm Execution
 */
async function testFullRouteWeatherPipeline(sourceQuery, destQuery) {
  console.log(`\n==================================================`);
  console.log(`TESTING PIPELINE: ${sourceQuery} -> ${destQuery}`);
  console.log(`==================================================`);

  const tStart = Date.now();

  // STEP 1: Geocode Source and Destination
  const sourceInfo = await geocodeLocation(sourceQuery);
  const destInfo = await geocodeLocation(destQuery);

  if (!sourceInfo || !destInfo) {
    console.error('Failed to geocode source or destination');
    return;
  }

  console.log(`Source: ${sourceInfo.name} (${sourceInfo.latitude}, ${sourceInfo.longitude})`);
  console.log(`Dest: ${destInfo.name} (${destInfo.latitude}, ${destInfo.longitude})`);

  // STEP 2: Compute Google Route
  const routeData = await computeGoogleRoute(sourceInfo, destInfo);
  if (!routeData) {
    console.error('Failed to calculate route');
    return;
  }

  console.log(`\n[DEBUG] Google Route Distance: ${routeData.distance_km} km`);
  console.log(`[DEBUG] Google Route Duration: ${routeData.duration_minutes} min`);
  console.log(`[DEBUG] Decoded Polyline Points: ${routeData.polylinePoints.length}`);

  // STEP 3: Build Route Index for Line Segment Projections
  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  // STEP 4: Sample Route Geometry
  const sampleDistanceKm = Number(process.env.ROUTE_SAMPLE_DISTANCE_KM) || 5;
  const sampledCoords = sampleRouteGeometry(routeData.polylinePoints, sampleDistanceKm);
  console.log(`[DEBUG] Sampled Points Count: ${sampledCoords.length}`);

  // STEP 5: Discover Candidates via Overpass & Reverse Geocoding
  const searchRadiusKm = Number(process.env.ROUTE_PLACE_SEARCH_RADIUS_KM) || 5;
  console.log(`[DEBUG] Running Overpass corridor search (radius: ${searchRadiusKm} km)...`);
  const overpassCandidates = await discoverOverpassSettlements(routeData.polylinePoints, routeIndex, searchRadiusKm);
  console.log(`[DEBUG] Overpass returned ${overpassCandidates.length} raw candidates.`);

  console.log(`[DEBUG] Running Reverse Geocoding on sampled points...`);
  const revGeoCandidates = await reverseGeocodeSamplePoints(sampledCoords);
  console.log(`[DEBUG] Reverse geocoding returned ${revGeoCandidates.length} raw candidates.`);

  const allCandidates = [...overpassCandidates, ...revGeoCandidates];
  console.log(`[DEBUG] Total Raw Candidates: ${allCandidates.length}`);

  // STEP 6: Perpendicular Line Segment Validation & Route Projection
  const maxPlaceDistanceKm = Number(process.env.ROUTE_PLACE_MAX_DISTANCE_KM) || 2;
  const sourceNorm = sourceInfo.name.toLowerCase().trim();
  const destNorm = destInfo.name.toLowerCase().trim();
  const totalDistanceKm = routeData.distance_km;
  const marginKm = Math.min(8.0, totalDistanceKm * 0.05);

  const acceptedCandidatesMap = new Map();

  console.log(`\n--- Candidate Evaluation Logs ---`);
  for (const cand of allCandidates) {
    const proj = projectPointToRoute(cand.latitude, cand.longitude, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distFromStart = proj.distanceFromStartKm;
    const nameNorm = cand.name.toLowerCase().trim();

    // Rejection checks
    if (distFromRoute > maxPlaceDistanceKm) {
      console.log(`[Candidate] ${cand.name} @ (${cand.latitude.toFixed(4)}, ${cand.longitude.toFixed(4)}) - Distance to route: ${distFromRoute} km -> REJECTED (exceeds ${maxPlaceDistanceKm} km max distance)`);
      continue;
    }

    if (distFromStart < marginKm || (totalDistanceKm - distFromStart) < marginKm) {
      console.log(`[Candidate] ${cand.name} @ (${cand.latitude.toFixed(4)}, ${cand.longitude.toFixed(4)}) - Dist from start: ${distFromStart} km -> REJECTED (too close to start/end margin ${marginKm} km)`);
      continue;
    }

    if (nameNorm === sourceNorm || nameNorm === destNorm || sourceNorm.includes(nameNorm) || destNorm.includes(nameNorm)) {
      console.log(`[Candidate] ${cand.name} -> REJECTED (matches source/destination name)`);
      continue;
    }

    console.log(`[Candidate] ${cand.name} (${cand.placeType}) @ (${cand.latitude.toFixed(4)}, ${cand.longitude.toFixed(4)}) - Distance to route: ${distFromRoute} km, Dist from start: ${distFromStart} km -> ACCEPTED`);

    if (!acceptedCandidatesMap.has(nameNorm)) {
      acceptedCandidatesMap.set(nameNorm, {
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

  const acceptedList = Array.from(acceptedCandidatesMap.values()).sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);
  console.log(`\n[DEBUG] Total Accepted Candidates: ${acceptedList.length}`);

  // STEP 7: Spacing & Ranking
  const minSpacingKm = Number(process.env.MIN_PLACE_SPACING_KM) || 10;
  const maxIntermediatePlaces = Number(process.env.MAX_INTERMEDIATE_PLACES) || 10;
  const spacedPlaces = [];

  for (const place of acceptedList) {
    const nearbyIdx = spacedPlaces.findIndex(p => Math.abs(p.distance_from_start_km - place.distance_from_start_km) < minSpacingKm);
    if (nearbyIdx !== -1) {
      if (place.typeRank < spacedPlaces[nearbyIdx].typeRank) {
        spacedPlaces[nearbyIdx] = place;
      }
    } else {
      spacedPlaces.push(place);
    }
  }

  spacedPlaces.sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);

  let selectedIntermediate = spacedPlaces;
  if (selectedIntermediate.length > maxIntermediatePlaces) {
    const step = selectedIntermediate.length / maxIntermediatePlaces;
    const subset = [];
    for (let i = 0; i < maxIntermediatePlaces; i++) {
      subset.push(selectedIntermediate[Math.floor(i * step)]);
    }
    selectedIntermediate = subset;
  }

  // STEP 8: Construct Final Route Sequence
  const finalPlaces = [
    {
      name: sourceInfo.name,
      type: 'source',
      latitude: sourceInfo.latitude,
      longitude: sourceInfo.longitude,
      distance_from_start_km: 0
    },
    ...selectedIntermediate,
    {
      name: destInfo.name,
      type: 'destination',
      latitude: destInfo.latitude,
      longitude: destInfo.longitude,
      distance_from_start_km: totalDistanceKm
    }
  ];

  console.log(`\n==================================================`);
  console.log(`FINAL ROUTE PLACES (${finalPlaces.length}) [Total Pipeline Time: ${Date.now() - tStart} ms]:`);
  console.log(`==================================================`);
  finalPlaces.forEach(p => {
    console.log(` - ${p.name} (${p.type}) | ${p.distance_from_start_km} km`);
  });
}

async function main() {
  await testFullRouteWeatherPipeline('Morbi', 'Rajkot');
  await testFullRouteWeatherPipeline('Morbi', 'Mumbai');
}

main();
