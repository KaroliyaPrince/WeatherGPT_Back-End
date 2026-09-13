const axios = require('axios');
const { decodePolyline } = require('../utils/polylineDecoder');
const { getEnvConfig } = require('../config/env');

const GOOGLE_ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const GOOGLE_GEOCODE_API_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEOUT_MS = 10000;

// High-Reliability Preset Dictionary for Top Regional Cities & Towns
const PRESET_CITIES = {
  'morbi': { name: 'Morbi', latitude: 22.8004, longitude: 70.8862 },
  'morvi': { name: 'Morbi', latitude: 22.8004, longitude: 70.8862 },
  'rajkot': { name: 'Rajkot', latitude: 22.3053, longitude: 70.8028 },
  'surat': { name: 'Surat', latitude: 21.1702, longitude: 72.8311 },
  'mumbai': { name: 'Mumbai', latitude: 19.0760, longitude: 72.8777 },
  'ahmedabad': { name: 'Ahmedabad', latitude: 23.0225, longitude: 72.5714 },
  'vadodara': { name: 'Vadodara', latitude: 22.3072, longitude: 73.1812 },
  'baroda': { name: 'Vadodara', latitude: 22.3072, longitude: 73.1812 },
  'delhi': { name: 'Delhi', latitude: 28.6139, longitude: 77.2090 },
  'tankara': { name: 'Tankara', latitude: 22.6562, longitude: 70.7495 },
  'wankaner': { name: 'Wankaner', latitude: 22.6120, longitude: 70.9438 },
  'jamnagar': { name: 'Jamnagar', latitude: 22.4707, longitude: 70.0577 },
  'bhavnagar': { name: 'Bhavnagar', latitude: 21.7645, longitude: 72.1519 },
  'gandhinagar': { name: 'Gandhinagar', latitude: 23.2156, longitude: 72.6369 },
  'junagadh': { name: 'Junagadh', latitude: 21.5222, longitude: 70.4579 },
  'porbandar': { name: 'Porbandar', latitude: 21.6417, longitude: 69.6293 },
  'anand': { name: 'Anand', latitude: 22.5645, longitude: 72.9289 },
  'bharuch': { name: 'Bharuch', latitude: 21.7051, longitude: 72.9959 },
  'valsad': { name: 'Valsad', latitude: 20.5992, longitude: 72.9342 },
  'vapi': { name: 'Vapi', latitude: 20.3893, longitude: 72.9106 },
  'navsari': { name: 'Navsari', latitude: 20.9467, longitude: 72.9520 },
  'nadiad': { name: 'Nadiad', latitude: 22.6916, longitude: 72.8634 },
  'godhra': { name: 'Godhra', latitude: 22.7758, longitude: 73.6149 },
  'patan': { name: 'Patan', latitude: 23.8493, longitude: 72.1266 },
  'palanpur': { name: 'Palanpur', latitude: 24.1724, longitude: 72.4346 },
  'mehsana': { name: 'Mehsana', latitude: 23.5880, longitude: 72.3693 },
  'veraval': { name: 'Veraval', latitude: 20.9000, longitude: 70.3667 },
  'bhuj': { name: 'Bhuj', latitude: 23.2420, longitude: 69.6669 },
  'gandhidham': { name: 'Gandhidham', latitude: 23.0753, longitude: 70.1337 }
};

/**
 * Cleans administrative suffixes from candidate settlement names
 */
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

/**
 * Checks if two place names are identical or phonetic/spelling variants (e.g. Morvi vs Morbi)
 */
function isSameOrVariant(name1, name2) {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().trim().replace(/v/g, 'b');
  const n2 = name2.toLowerCase().trim().replace(/v/g, 'b');
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;
  return false;
}

/**
 * Haversine distance in kilometers between two { latitude, longitude } points
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Geocodes location query into { name, latitude, longitude }
 * Multi-Tier Resilient Pipeline: Preset Dictionary -> Google Geocoding -> Open-Meteo -> Nominatim -> Photon
 */
async function geocodeLocation(locationQuery) {
  if (!locationQuery || typeof locationQuery !== 'string' || locationQuery.trim() === '') {
    return null;
  }

  const query = locationQuery.trim();
  const normKey = query.toLowerCase();

  // Tier 0: Instant Preset Dictionary
  if (PRESET_CITIES[normKey]) {
    console.log(`[geocode] Preset Dictionary HIT for "${query}":`, PRESET_CITIES[normKey]);
    return { ...PRESET_CITIES[normKey] };
  }

  const config = getEnvConfig();

  // Tier 1: Primary Google Geocoding API
  if (config.googleMapsApiKey) {
    try {
      const response = await axios.get(GOOGLE_GEOCODE_API_URL, {
        params: { address: query, key: config.googleMapsApiKey },
        timeout: 5000
      });

      const results = response.data?.results;
      if (response.data?.status === 'OK' && Array.isArray(results) && results.length > 0) {
        const item = results[0];
        const location = item.geometry?.location;
        const addressComp = item.address_components || [];

        let name = query;
        const primaryComp = addressComp.find(c =>
          c.types.includes('locality') ||
          c.types.includes('postal_town') ||
          c.types.includes('administrative_area_level_2')
        );

        if (primaryComp && primaryComp.long_name) {
          name = cleanSettlementName(primaryComp.long_name) || primaryComp.long_name;
        } else if (item.formatted_address) {
          name = item.formatted_address.split(',')[0].trim();
        }

        if (location && location.lat !== undefined && location.lng !== undefined) {
          console.log(`[geocode] Google Geocode SUCCESS for "${query}": ${name} (${location.lat}, ${location.lng})`);
          return {
            name,
            latitude: Number(location.lat),
            longitude: Number(location.lng)
          };
        }
      } else {
        console.warn(`[geocode] Google Geocode non-OK status for "${query}": ${response.data?.status}`);
      }
    } catch (err) {
      console.warn(`[geocode] Google Geocode failed for "${query}": ${err.message}. Trying fallbacks...`);
    }
  }

  // Tier 2: Open-Meteo Geocoding API
  try {
    const searchQueries = [query];
    if (normKey.includes('morbi')) searchQueries.push('Morvi');

    for (const q of searchQueries) {
      const omRes = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
        params: { name: q, count: 10, language: 'en', format: 'json' },
        timeout: 4000
      });

      if (Array.isArray(omRes.data?.results) && omRes.data.results.length > 0) {
        const items = omRes.data.results;
        let match = items.find(i => i.country_code === 'IN' && (i.admin1 === 'Gujarat' || i.admin1 === 'Maharashtra' || i.population > 10000));
        if (!match) match = items.find(i => i.country_code === 'IN');
        if (!match) match = items[0];

        const cleaned = cleanSettlementName(match.name) || match.name;
        console.log(`[geocode] Open-Meteo Fallback SUCCESS for "${query}": ${cleaned} (${match.latitude}, ${match.longitude})`);
        return {
          name: cleaned,
          latitude: Number(match.latitude),
          longitude: Number(match.longitude)
        };
      }
    }
  } catch (err) {
    console.warn(`[geocode] Open-Meteo fallback failed for "${query}": ${err.message}`);
  }

  // Tier 3: Nominatim Search API
  try {
    const nomRes = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: `${query}, India`, format: 'json', limit: 1, addressdetails: 1 },
      headers: {
        'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)'
      },
      timeout: 4000
    });

    if (Array.isArray(nomRes.data) && nomRes.data.length > 0) {
      const item = nomRes.data[0];
      const rawName = item.address?.city || item.address?.town || item.address?.village || item.name || query;
      const cleaned = cleanSettlementName(rawName) || rawName.split(',')[0].trim();
      console.log(`[geocode] Nominatim Fallback SUCCESS for "${query}": ${cleaned} (${item.lat}, ${item.lon})`);
      return {
        name: cleaned,
        latitude: Number(item.lat),
        longitude: Number(item.lon)
      };
    }
  } catch (err) {
    console.warn(`[geocode] Nominatim fallback failed for "${query}": ${err.message}`);
  }

  // Tier 4: Photon Geocoder API
  try {
    const photonRes = await axios.get(`https://photon.komoot.io/api`, {
      params: { q: query, limit: 1 },
      headers: {
        'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)'
      },
      timeout: 4000
    });

    const features = photonRes.data?.features;
    if (Array.isArray(features) && features.length > 0) {
      const feature = features[0];
      const coords = feature.geometry?.coordinates; // [lon, lat]
      const props = feature.properties;
      if (coords && coords.length >= 2) {
        const rawName = props.name || props.city || props.town || query;
        const cleaned = cleanSettlementName(rawName) || rawName.split(',')[0].trim();
        console.log(`[geocode] Photon Fallback SUCCESS for "${query}": ${cleaned} (${coords[1]}, ${coords[0]})`);
        return {
          name: cleaned,
          latitude: Number(coords[1]),
          longitude: Number(coords[0])
        };
      }
    }
  } catch (err) {
    console.warn(`[geocode] Photon fallback failed for "${query}": ${err.message}`);
  }

  console.error(`[geocode] ERROR: All 5 geocoding tiers failed to resolve "${query}"`);
  return null;
}

/**
 * Computes driving route using Google Routes API Directions v2
 * Configurable via ROUTE_USE_TRAFFIC environment setting.
 */
async function computeGoogleRoute(sourceCoords, destCoords) {
  const config = getEnvConfig();

  if (config.googleMapsApiKey) {
    try {
      const routingPreference = config.routeUseTraffic ? 'TRAFFIC_AWARE' : 'ROUTING_PREFERENCE_UNSPECIFIED';

      const requestBody = {
        origin: { location: { latLng: { latitude: sourceCoords.latitude, longitude: sourceCoords.longitude } } },
        destination: { location: { latLng: { latitude: destCoords.latitude, longitude: destCoords.longitude } } },
        travelMode: 'DRIVE',
        routingPreference: routingPreference,
        computeAlternativeRoutes: false,
        routeModifiers: { avoidTolls: false, avoidHighways: false, avoidFerries: false },
        languageCode: 'en-US',
        units: 'METRIC'
      };

      const response = await axios.post(
        GOOGLE_ROUTES_API_URL,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': config.googleMapsApiKey,
            'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
          },
          timeout: TIMEOUT_MS
        }
      );

      const route = response.data?.routes?.[0];
      if (route && route.polyline && route.polyline.encodedPolyline) {
        const distanceMeters = Number(route.distanceMeters || 0);
        const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;

        let durationSeconds = 0;
        if (typeof route.duration === 'string') {
          durationSeconds = parseInt(route.duration.replace('s', ''), 10) || 0;
        } else if (typeof route.duration === 'number') {
          durationSeconds = route.duration;
        }
        const durationMinutes = Math.round(durationSeconds / 60);

        const polylinePoints = decodePolyline(route.polyline.encodedPolyline);

        return {
          distance_km: distanceKm,
          duration_minutes: durationMinutes,
          polylinePoints,
          encodedPolyline: route.polyline.encodedPolyline
        };
      }
    } catch (err) {
      console.warn(`[route-weather] Google Routes API failed (${err.message}). Trying OSRM fallback...`);
    }
  }

  // Fallback: OSRM Driving Directions API if Google Maps API key is not set or fails
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${sourceCoords.longitude},${sourceCoords.latitude};${destCoords.longitude},${destCoords.latitude}?overview=full&geometries=geojson`;
    const response = await axios.get(osrmUrl, {
      headers: {
        'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)'
      },
      timeout: TIMEOUT_MS
    });

    const route = response.data?.routes?.[0];
    if (route && route.geometry && route.geometry.coordinates) {
      const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
      const durationMinutes = Math.round(route.duration / 60);
      const polylinePoints = route.geometry.coordinates.map(c => ({
        latitude: c[1],
        longitude: c[0]
      }));

      return {
        distance_km: distanceKm,
        duration_minutes: durationMinutes,
        polylinePoints,
        encodedPolyline: null
      };
    }
  } catch (osrmErr) {
    console.error(`[route-weather] OSRM Fallback Route Failed: ${osrmErr.message}`);
  }

  return null;
}

/**
 * Precomputes route line segments and cumulative distances along decoded polyline points
 */
function buildRouteIndex(polylinePoints) {
  const segments = [];
  let totalDistanceKm = 0;

  for (let i = 0; i < polylinePoints.length - 1; i++) {
    const p1 = polylinePoints[i];
    const p2 = polylinePoints[i + 1];
    const segDist = haversineDistanceKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);

    segments.push({
      p1Lat: p1.latitude,
      p1Lon: p1.longitude,
      p2Lat: p2.latitude,
      p2Lon: p2.longitude,
      distKm: segDist,
      startAccumDistKm: totalDistanceKm
    });

    totalDistanceKm += segDist;
  }

  return { segments, totalDistanceKm };
}

/**
 * Projects candidate settlement coordinate onto route polyline line segments.
 */
function projectPointToRoute(placeLat, placeLon, routeIndex) {
  let minDistanceKm = Infinity;
  let bestDistFromStartKm = 0;

  for (const seg of routeIndex.segments) {
    const dx = seg.p2Lon - seg.p1Lon;
    const dy = seg.p2Lat - seg.p1Lat;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = ((placeLon - seg.p1Lon) * dx + (placeLat - seg.p1Lat) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projLon = seg.p1Lon + t * dx;
    const projLat = seg.p1Lat + t * dy;

    const distToSeg = haversineDistanceKm(placeLat, placeLon, projLat, projLon);
    if (distToSeg < minDistanceKm) {
      minDistanceKm = distToSeg;
      bestDistFromStartKm = seg.startAccumDistKm + t * seg.distKm;
    }
  }

  return {
    distanceFromRouteKm: Math.round(minDistanceKm * 100) / 100,
    distanceFromStartKm: Math.round(bestDistFromStartKm * 10) / 10
  };
}

/**
 * Samples decoded polyline points using configured ROUTE_SAMPLE_DISTANCE_KM
 */
function sampleRouteGeometry(polylinePoints, sampleDistanceKm = 5) {
  if (!Array.isArray(polylinePoints) || polylinePoints.length < 2) {
    return [];
  }

  let totalKm = 0;
  for (let i = 0; i < polylinePoints.length - 1; i++) {
    totalKm += haversineDistanceKm(
      polylinePoints[i].latitude, polylinePoints[i].longitude,
      polylinePoints[i+1].latitude, polylinePoints[i+1].longitude
    );
  }

  const stepKm = Number(sampleDistanceKm) > 0 ? Number(sampleDistanceKm) : 5;
  const sampled = [];
  let accumulatedDist = 0;
  let nextTargetKm = stepKm;
  let prev = polylinePoints[0];

  for (let i = 1; i < polylinePoints.length; i++) {
    const curr = polylinePoints[i];
    const seg = haversineDistanceKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    accumulatedDist += seg;

    if (accumulatedDist >= nextTargetKm && (totalKm - accumulatedDist) > 3.0) {
      sampled.push({
        latitude: curr.latitude,
        longitude: curr.longitude,
        roadDistanceKm: accumulatedDist
      });
      nextTargetKm += stepKm;
    }

    prev = curr;
  }

  return sampled;
}

/**
 * External Reverse Geocoding Providers (BigDataCloud, Photon, Nominatim, Overpass)
 */
async function reverseGeocodeBigDataCloud(lat, lon) {
  try {
    const res = await axios.get('https://api.bigdatacloud.net/data/reverse-geocode-client', {
      params: { latitude: lat, longitude: lon, localityLanguage: 'en' },
      headers: { 'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)' },
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
    return [];
  }
}

async function reverseGeocodePhoton(lat, lon) {
  try {
    const res = await axios.get('https://photon.komoot.io/reverse', {
      params: { lat, lon },
      headers: { 'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)' },
      timeout: 3000
    });
    const feats = res.data?.features || [];
    const candidates = [];
    for (const f of feats) {
      const props = f.properties || {};
      const candidateName = props.city || props.town || props.village || props.locality || props.district || props.county || props.name;
      if (candidateName) {
        const cleaned = cleanSettlementName(candidateName);
        if (cleaned) {
          const coords = f.geometry?.coordinates || [lon, lat];
          candidates.push({
            name: cleaned,
            latitude: Number(coords[1]),
            longitude: Number(coords[0]),
            placeType: props.type === 'city' ? 'city' : 'town',
            source: 'photon',
            rank: props.type === 'city' ? 10 : 8
          });
        }
      }
    }
    return candidates;
  } catch (err) {
    return [];
  }
}

async function reverseGeocodeNominatim(lat, lon) {
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: { lat, lon, format: 'json', zoom: 14, addressdetails: 1 },
      headers: { 'User-Agent': 'WeatherGPT-Production-App/1.0 (sih-hackathon@weathergpt.io)' },
      timeout: 3500
    });
    const addr = res.data?.address || {};
    const candidateName = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.locality || addr.district || addr.state_district || addr.county;
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
    return [];
  }
}

/**
 * Unified Reverse Geocoding Engine
 * Resolves (lat, lon) coordinates to clean human-readable city/town name.
 */
async function reverseGeocodeLocation(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (isNaN(latitude) || isNaN(longitude)) return null;

  // Tier 0: Canonical Places DB
  try {
    const { findCanonicalPlace } = require('./canonicalPlacesService');
    const match = findCanonicalPlace(null, latitude, longitude);
    if (match && match.name) {
      console.log(`[rev-geocode] Canonical DB match: ${match.name} (${latitude}, ${longitude})`);
      return { name: match.name, latitude: match.latitude, longitude: match.longitude };
    }
  } catch (e) {}

  // Tier 1: Nominatim Reverse
  try {
    const nom = await reverseGeocodeNominatim(latitude, longitude);
    if (nom.length > 0 && nom[0].name) {
      console.log(`[rev-geocode] Nominatim match: ${nom[0].name} (${latitude}, ${longitude})`);
      return { name: nom[0].name, latitude, longitude };
    }
  } catch (e) {}

  // Tier 2: Photon Reverse
  try {
    const photon = await reverseGeocodePhoton(latitude, longitude);
    if (photon.length > 0 && photon[0].name) {
      console.log(`[rev-geocode] Photon match: ${photon[0].name} (${latitude}, ${longitude})`);
      return { name: photon[0].name, latitude, longitude };
    }
  } catch (e) {}

  // Tier 3: BigDataCloud Reverse
  try {
    const bdc = await reverseGeocodeBigDataCloud(latitude, longitude);
    if (bdc.length > 0 && bdc[0].name) {
      console.log(`[rev-geocode] BigDataCloud match: ${bdc[0].name} (${latitude}, ${longitude})`);
      return { name: bdc[0].name, latitude, longitude };
    }
  } catch (e) {}

  return null;
}

/**
 * Global City Search / Autocomplete API Provider
 */
async function searchCities(queryStr) {
  if (!queryStr || typeof queryStr !== 'string' || queryStr.trim().length === 0) {
    return [];
  }
  const query = queryStr.trim().toLowerCase();
  const resultsMap = new Map();

  // 1. Check Canonical Preset Cities
  try {
    const { CANONICAL_PLACES } = require('../data/canonicalPlaces');
    for (const p of CANONICAL_PLACES) {
      if (p.name.toLowerCase().includes(query) || p.id.includes(query)) {
        const key = `${p.name.toLowerCase()}:${p.latitude.toFixed(2)}:${p.longitude.toFixed(2)}`;
        resultsMap.set(key, {
          name: p.name,
          state: 'Gujarat',
          country: 'India',
          latitude: p.latitude,
          longitude: p.longitude,
          source: 'canonical'
        });
      }
    }
  } catch (e) {}

  // 2. Open-Meteo Geocoding Search API
  try {
    const omRes = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: { name: queryStr, count: 10, language: 'en', format: 'json' },
      timeout: 4000
    });
    if (Array.isArray(omRes.data?.results)) {
      for (const item of omRes.data.results) {
        const cleaned = cleanSettlementName(item.name) || item.name;
        const key = `${cleaned.toLowerCase()}:${Number(item.latitude).toFixed(2)}:${Number(item.longitude).toFixed(2)}`;
        if (!resultsMap.has(key)) {
          resultsMap.set(key, {
            name: cleaned,
            state: item.admin1 || item.admin2 || '',
            country: item.country || '',
            country_code: item.country_code || '',
            latitude: Number(item.latitude),
            longitude: Number(item.longitude),
            population: item.population || 0,
            source: 'open-meteo'
          });
        }
      }
    }
  } catch (e) {}

  // 3. Photon Geocoding Search API
  try {
    const pRes = await axios.get('https://photon.komoot.io/api', {
      params: { q: queryStr, limit: 10 },
      headers: { 'User-Agent': 'WeatherGPT-App/1.0 (contact@weathergpt.io)' },
      timeout: 3500
    });
    if (Array.isArray(pRes.data?.features)) {
      for (const f of pRes.data.features) {
        const props = f.properties || {};
        const name = props.name || props.city || props.town;
        const coords = f.geometry?.coordinates;
        if (name && coords && coords.length >= 2) {
          const cleaned = cleanSettlementName(name) || name;
          const key = `${cleaned.toLowerCase()}:${Number(coords[1]).toFixed(2)}:${Number(coords[0]).toFixed(2)}`;
          if (!resultsMap.has(key)) {
            resultsMap.set(key, {
              name: cleaned,
              state: props.state || props.county || '',
              country: props.country || '',
              latitude: Number(coords[1]),
              longitude: Number(coords[0]),
              source: 'photon'
            });
          }
        }
      }
    }
  } catch (e) {}

  return Array.from(resultsMap.values());
}

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

module.exports = {
  cleanSettlementName,
  isSameOrVariant,
  haversineDistanceKm,
  geocodeLocation,
  reverseGeocodeLocation,
  searchCities,
  computeGoogleRoute,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry,
  reverseGeocodeBigDataCloud,
  reverseGeocodePhoton,
  reverseGeocodeNominatim,
  queryOverpassCorridor
};
