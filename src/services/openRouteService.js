const {
  getGoogleApiKey,
  geocodeLocation,
  computeGoogleRoute,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry,
  reverseGeocodeSample,
  extractSettlementFromReverseGeocode,
  getSamplingDistanceKm,
  getMaxPlaceDistanceKm,
  isAdministrativeName
} = require('./googleRoutesService');

/**
 * Compatibility wrapper for getDrivingRoute using Google Routes API
 */
async function getDrivingRoute(sourceCoords, destCoords) {
  const result = await computeGoogleRoute(sourceCoords, destCoords);
  if (!result) return null;

  // Map to format expected by controllers
  const coordinates = (result.polylinePoints || []).map(p => [p.longitude, p.latitude]);

  return {
    distance_km: result.distance_km,
    duration_minutes: result.duration_minutes,
    coordinates: coordinates,
    polylinePoints: result.polylinePoints,
    encodedPolyline: result.encodedPolyline
  };
}

/**
 * Helper to execute array of promises with max concurrency
 */
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

/**
 * PRODUCTION-GRADE DYNAMIC ROUTE-PLACE DETECTION ALGORITHM (Google Pipeline):
 * 1. Decodes Google Routes API encoded polyline points into coordinates.
 * 2. Samples route geometry dynamically every ROUTE_SAMPLE_DISTANCE_KM (default: 4 km).
 * 3. Performs reverse-geocoding for sampled coordinates with controlled concurrency.
 * 4. Extracts clean settlements (locality/town/city), excluding businesses, POIs, and administrative boundary names.
 * 5. Validates perpendicular distance from candidate settlement center to route polyline (<= ROUTE_PLACE_MAX_DISTANCE_KM = 2 km).
 * 6. Computes projected cumulative road distance along route (distance_from_start_km).
 * 7. Deduplicates by normalized settlement name and proximity.
 * 8. Returns Source -> Ordered Discovered Places -> Destination.
 */
async function detectRoutePlaces(routeCoordinates, sourceInfo, destInfo, totalDistanceKm, extraOptions = {}) {
  const sourceNormalized = sourceInfo.name.toLowerCase().trim();
  const destNormalized = destInfo.name.toLowerCase().trim();

  // Convert routeCoordinates array to { latitude, longitude } array if needed
  let polylinePoints = [];
  if (Array.isArray(routeCoordinates) && routeCoordinates.length > 0) {
    if (typeof routeCoordinates[0] === 'object' && routeCoordinates[0].latitude !== undefined) {
      polylinePoints = routeCoordinates;
    } else if (Array.isArray(routeCoordinates[0])) {
      polylinePoints = routeCoordinates.map(c => ({ latitude: c[1], longitude: c[0] }));
    }
  }

  if (polylinePoints.length < 2) {
    return [
      {
        name: sourceInfo.name,
        type: 'source',
        latitude: sourceInfo.latitude,
        longitude: sourceInfo.longitude,
        distance_from_start_km: 0
      },
      {
        name: destInfo.name,
        type: 'destination',
        latitude: destInfo.latitude,
        longitude: destInfo.longitude,
        distance_from_start_km: totalDistanceKm
      }
    ];
  }

  // STEP 1: Precompute Route Index
  const routeIndex = buildRouteIndex(polylinePoints);

  // STEP 2: Sample Route Geometry
  const sampleDistanceKm = extraOptions.sampleDistanceKm || getSamplingDistanceKm();
  const maxPlaceDistanceKm = extraOptions.maxPlaceDistanceKm || getMaxPlaceDistanceKm();

  const sampledCoords = sampleRouteGeometry(polylinePoints, sampleDistanceKm);

  // STEP 3: Reverse Geocode Sampled Points with Controlled Concurrency
  const concurrencyLimit = Number(process.env.REVERSE_GEOCODE_CONCURRENCY) || 4;

  const reverseGeocodeResults = await mapWithConcurrency(
    sampledCoords,
    concurrencyLimit,
    async (sample) => {
      const geoResult = await reverseGeocodeSample(sample.latitude, sample.longitude);
      const settlement = extractSettlementFromReverseGeocode(geoResult, sample.latitude, sample.longitude);
      return { sample, settlement };
    }
  );

  // STEP 4: Validate, Filter, and Calculate Proximity for Candidates
  const candidatePlaces = [];
  const seenNames = new Set();
  seenNames.add(sourceNormalized);
  seenNames.add(destNormalized);

  const marginKm = Math.min(8.0, totalDistanceKm * 0.05);

  for (const item of reverseGeocodeResults) {
    if (!item || !item.settlement) continue;

    const { settlement } = item;
    const name = settlement.name;
    const nameNorm = name.toLowerCase().trim();

    // Reject administrative boundary names
    if (isAdministrativeName(name)) continue;

    // Reject Source / Destination matches or duplicates
    if (seenNames.has(nameNorm) ||
        sourceNormalized.includes(nameNorm) || destNormalized.includes(nameNorm) ||
        nameNorm.includes(sourceNormalized) || nameNorm.includes(destNormalized)) {
      continue;
    }

    // Proximity Validation against Google Route Polyline
    const proj = projectPointToRoute(settlement.latitude, settlement.longitude, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distAlongRoute = proj.distanceFromStartKm;

    if (distFromRoute > maxPlaceDistanceKm) {
      continue;
    }

    if (distAlongRoute < marginKm || (totalDistanceKm - distAlongRoute) < marginKm) {
      continue;
    }

    seenNames.add(nameNorm);
    candidatePlaces.push({
      name: name,
      type: 'route_place',
      latitude: settlement.latitude,
      longitude: settlement.longitude,
      distance_from_start_km: distAlongRoute,
      typeRank: settlement.placeType === 'city' ? 1 : (settlement.placeType === 'town' ? 2 : 3)
    });
  }

  // Sort candidate places by road distance along route
  candidatePlaces.sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);

  // Deduplicate and cluster settlements close to each other
  const minSpacingKm = totalDistanceKm < 100 ? 10 : (totalDistanceKm < 400 ? 20 : 35);
  const filteredPlaces = [];

  for (const place of candidatePlaces) {
    const nearbyIndex = filteredPlaces.findIndex(p => Math.abs(p.distance_from_start_km - place.distance_from_start_km) < minSpacingKm);

    if (nearbyIndex !== -1) {
      if (place.typeRank < filteredPlaces[nearbyIndex].typeRank) {
        filteredPlaces[nearbyIndex] = place;
      }
    } else {
      filteredPlaces.push(place);
    }
  }

  filteredPlaces.sort((a, b) => a.distance_from_start_km - b.distance_from_start_km);

  // Format final ordered list: Source -> Discovered Route Places -> Destination
  const finalPlaces = [
    {
      name: sourceInfo.name,
      type: 'source',
      latitude: sourceInfo.latitude,
      longitude: sourceInfo.longitude,
      distance_from_start_km: 0
    }
  ];

  filteredPlaces.forEach(p => {
    finalPlaces.push({
      name: p.name,
      type: 'route_place',
      latitude: p.latitude,
      longitude: p.longitude,
      distance_from_start_km: p.distance_from_start_km
    });
  });

  finalPlaces.push({
    name: destInfo.name,
    type: 'destination',
    latitude: destInfo.latitude,
    longitude: destInfo.longitude,
    distance_from_start_km: totalDistanceKm
  });

  return finalPlaces;
}

module.exports = {
  getGoogleApiKey,
  geocodeLocation,
  getDrivingRoute,
  computeGoogleRoute,
  detectRoutePlaces,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry,
  reverseGeocodeSample,
  extractSettlementFromReverseGeocode,
  isAdministrativeName,
  MAX_ROUTE_DISTANCE_KM: 2.0
};
