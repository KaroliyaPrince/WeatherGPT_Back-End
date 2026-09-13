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

function cleanSettlementName(rawName) {
  if (!rawName || typeof rawName !== 'string') return null;
  let name = rawName.trim();
  name = name.replace(/\b(Taluka|Taluk|District|Tehsil|Tahsil|Sub-District|Subdistrict|Mandalam|County|State|Province|Zone|Municipality|Division)\b/gi, '').trim();
  name = name.replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();
  if (name.length < 2) return null;
  const lower = name.toLowerCase();
  const forbidden = ['india', 'gujarat', 'maharashtra', 'karnataka', 'district', 'taluka', 'tehsil', 'division', 'state', 'county'];
  if (forbidden.includes(lower)) return null;
  return name;
}

function isSameOrVariant(name1, name2) {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().trim().replace(/v/g, 'b');
  const n2 = name2.toLowerCase().trim().replace(/v/g, 'b');
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;
  return false;
}

// 1. BigDataCloud Reverse Geocoding
async function reverseGeocodeBigDataCloud(lat, lon) {
  try {
    const res = await axios.get('https://api.bigdatacloud.net/data/reverse-geocode-client', {
      params: { latitude: lat, longitude: lon, localityLanguage: 'en' },
      headers: {
        'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)'
      },
      timeout: 3500
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
            placeType: item.description?.toLowerCase().includes('city') ? 'city' : 'town',
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
    console.error(`[Route Discovery ERROR] BigDataCloud (${lat}, ${lon}):`, err.response?.status, err.message);
    return [];
  }
}

// 2. Photon Reverse Geocoding
async function reverseGeocodePhoton(lat, lon) {
  try {
    const res = await axios.get('https://photon.komoot.io/reverse', {
      params: { lat, lon },
      headers: {
        'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)'
      },
      timeout: 3000
    });
    const feats = res.data?.features || [];
    const candidates = [];
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
            placeType: type === 'city' ? 'city' : 'town',
            source: 'photon',
            rank: type === 'city' ? 10 : 8
          });
        }
      }
    }
    return candidates;
  } catch (err) {
    console.error(`[Route Discovery ERROR] Photon (${lat}, ${lon}):`, err.response?.status, err.message);
    return [];
  }
}

// 3. Nominatim Reverse Geocoding
async function reverseGeocodeNominatim(lat, lon) {
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json', zoom: 14, addressdetails: 1 },
      headers: {
        'User-Agent': 'WeatherGPT-Production-App/1.0 (sih-hackathon@weathergpt.io)'
      },
      timeout: 3500
    });
    const addr = res.data?.address || {};
    const candidateName = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.locality;
    if (candidateName) {
      const cleaned = cleanSettlementName(candidateName);
      if (cleaned) {
        return [{
          name: cleaned,
          latitude: Number(res.data.lat || lat),
          longitude: Number(res.data.lon || lon),
          placeType: addr.city ? 'city' : 'town',
          source: 'nominatim',
          rank: addr.city ? 10 : 8
        }];
      }
    }
  } catch (err) {
    console.error(`[Route Discovery ERROR] Nominatim (${lat}, ${lon}):`, err.response?.status, err.message);
  }
  return [];
}

// 4. Overpass Corridor Discovery
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
  const south = minLat - pad;
  const west = minLon - pad;
  const north = maxLat + pad;
  const east = maxLon + pad;
  const bbox = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`;
  const query = `[out:json][timeout:4];node["place"~"city|town|village|municipality"](${bbox});out body;`;

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
      if (res.data?.elements) {
        console.log(`[Route Discovery] Overpass request status: ${res.status} via ${ep} (${res.data.elements.length} elements)`);
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
    } catch (err) {
      console.error(`[Route Discovery ERROR] Overpass (${ep}):`, err.response?.status, err.message);
    }
  }
  return [];
}

async function testDiscoveryPipeline(sourceQuery, destQuery) {
  console.log(`\n==================================================`);
  console.log(`TESTING DISCOVERY PIPELINE: ${sourceQuery} -> ${destQuery}`);
  console.log(`==================================================`);

  const t0 = Date.now();
  const sourceInfo = await geocodeLocation(sourceQuery);
  const destInfo = await geocodeLocation(destQuery);
  const routeData = await computeGoogleRoute(sourceInfo, destInfo);

  if (!routeData) {
    console.error('[Route Discovery ERROR] Google Route computation failed');
    return;
  }

  console.log(`[Route Discovery] Starting place discovery`);
  console.log(`[Route Discovery] Route points: ${routeData.polylinePoints.length}`);
  console.log(`[Route Discovery] Route distance: ${routeData.distance_km} km`);

  const routeIndex = buildRouteIndex(routeData.polylinePoints);

  const sampleDistKm = routeData.distance_km < 100 ? 5 : (routeData.distance_km < 400 ? 10 : 15);
  const sampledCoords = sampleRouteGeometry(routeData.polylinePoints, sampleDistKm);
  console.log(`[Route Discovery] Sampled points: ${sampledCoords.length}`);

  console.log(`[Route Discovery] Querying settlement data across multi-providers...`);

  // Run BigDataCloud, Photon, Nominatim, Overpass in parallel
  const [bdcRes, photonRes, nomRes, overpassRes] = await Promise.all([
    Promise.all(sampledCoords.map(s => reverseGeocodeBigDataCloud(s.latitude, s.longitude))),
    Promise.all(sampledCoords.map(s => reverseGeocodePhoton(s.latitude, s.longitude))),
    Promise.all(sampledCoords.map(s => reverseGeocodeNominatim(s.latitude, s.longitude))),
    queryOverpassCorridor(routeData.polylinePoints)
  ]);

  const rawCandidates = [
    ...bdcRes.flat(),
    ...photonRes.flat(),
    ...nomRes.flat(),
    ...overpassRes
  ];

  console.log(`[Route Discovery] Candidates found: ${rawCandidates.length}`);

  const maxDistKm = Number(process.env.ROUTE_PLACE_MAX_DISTANCE_KM) || 2;
  const totalDistKm = routeData.distance_km;
  const marginKm = Math.min(8.0, totalDistKm * 0.05);

  const sourceNorm = sourceInfo.name;
  const destNorm = destInfo.name;
  const acceptedMap = new Map();

  for (const cand of rawCandidates) {
    const proj = projectPointToRoute(cand.latitude, cand.longitude, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distFromStart = proj.distanceFromStartKm;
    const nameKey = cand.name.toLowerCase().trim();

    if (distFromRoute > maxDistKm) continue;
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
  console.log(`[Route Discovery] Valid route places: ${rawAccepted.length}`);

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
  console.log(`DISCOVERED PLACES (${finalSequence.length}) [Time: ${Date.now() - t0} ms]:`);
  console.log(`==================================================`);
  finalSequence.forEach(p => {
    console.log(` - ${p.name} (${p.type}) | ${p.distance_from_start_km} km ${p.source ? `[via ${p.source}]` : ''}`);
  });
}

async function main() {
  await testDiscoveryPipeline('Morbi', 'Surat');
}

main();
