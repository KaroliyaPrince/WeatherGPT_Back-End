const { CANONICAL_PLACES } = require('../data/canonicalPlaces');
const { haversineDistanceKm } = require('./googleRoutesService');

/**
 * Normalizes input name string for matching
 * e.g., "Tankara Town" -> "tankara town", "Morbi Taluka" -> "morbi"
 */
function normalizePlaceName(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';
  let name = rawName.trim().toLowerCase();
  name = name.replace(/\b(taluka|taluk|district|tehsil|tahsil|sub-district|subdistrict|mandalam|county|state|province|zone|municipality|division|city|town|village)\b/gi, '').trim();
  name = name.replace(/^[,\-\s]+|[,\-\s]+$/g, '').trim();
  return name;
}

/**
 * Checks if two place names match phonetically/spelling-wise
 * e.g., Morbi vs Morvi, Limdi vs Limbdi
 */
function isPhoneticMatch(name1, name2) {
  const norm1 = normalizePlaceName(name1).replace(/v/g, 'b');
  const norm2 = normalizePlaceName(name2).replace(/v/g, 'b');
  if (!norm1 || !norm2) return false;
  if (norm1 === norm2) return true;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
  return false;
}

/**
 * Matches a raw name or coordinate query against the Canonical Places database.
 * Returns the canonical place object if matched, or null.
 */
function findCanonicalPlace(rawName, latitude, longitude) {
  const normQuery = normalizePlaceName(rawName);

  // 1. Try exact or alias string match
  for (const place of CANONICAL_PLACES) {
    if (place.id === normQuery || place.name.toLowerCase() === normQuery) {
      return place;
    }
    for (const alias of place.aliases) {
      if (normalizePlaceName(alias) === normQuery || isPhoneticMatch(alias, rawName)) {
        return place;
      }
    }
  }

  // 2. Try spatial proximity match if coordinates are provided
  if (latitude !== undefined && longitude !== undefined && !isNaN(Number(latitude)) && !isNaN(Number(longitude))) {
    const lat = Number(latitude);
    const lon = Number(longitude);

    let closestPlace = null;
    let minDistance = Infinity;

    for (const place of CANONICAL_PLACES) {
      const dist = haversineDistanceKm(lat, lon, place.latitude, place.longitude);
      if (dist < minDistance && dist <= 12.0) {
        if (!normQuery || isPhoneticMatch(place.name, rawName) || dist <= 5.0) {
          minDistance = dist;
          closestPlace = place;
        }
      }
    }

    if (closestPlace) {
      return closestPlace;
    }
  }

  return null;
}

/**
 * Projects all known canonical places onto the calculated Google Route polyline
 * 100% Deterministic: Uses spatial projection on polyline line segments.
 */
function matchKnownPlacesAlongRoute(routeIndex, totalDistanceKm, projectPointToRouteFn, options = {}) {
  const maxPlaceDistanceKm = Number(options.maxPlaceDistanceKm) || 2.0;
  const marginKm = Math.min(8.0, totalDistanceKm * 0.05);

  const sourceNorm = normalizePlaceName(options.sourceName || '');
  const destNorm = normalizePlaceName(options.destName || '');

  const sourceCanonical = findCanonicalPlace(options.sourceName, options.sourceLat, options.sourceLon);
  const destCanonical = findCanonicalPlace(options.destName, options.destLat, options.destLon);

  const sourceId = sourceCanonical ? sourceCanonical.id : null;
  const destId = destCanonical ? destCanonical.id : null;

  const matched = [];

  for (const place of CANONICAL_PLACES) {
    // Exclude source and destination places
    if (sourceId && place.id === sourceId) continue;
    if (destId && place.id === destId) continue;
    if (isPhoneticMatch(place.name, sourceNorm) || isPhoneticMatch(place.name, destNorm)) continue;

    // Project canonical coordinates onto polyline
    const proj = projectPointToRouteFn(place.latitude, place.longitude, routeIndex);
    const distFromRoute = proj.distanceFromRouteKm;
    const distFromStart = proj.distanceFromStartKm;

    if (distFromRoute <= maxPlaceDistanceKm &&
        distFromStart >= marginKm &&
        (totalDistanceKm - distFromStart) >= marginKm) {
      matched.push({
        id: place.id,
        name: place.name,
        type: 'route_place',
        latitude: place.latitude,       // CANONICAL COORDINATES
        longitude: place.longitude,     // CANONICAL COORDINATES
        distance_from_start_km: distFromStart,
        distanceFromRouteKm: distFromRoute,
        placeType: place.placeType,
        rank: place.placeType === 'city' ? 10 : (place.placeType === 'town' ? 8 : 6),
        source: 'canonical_database'
      });
    }
  }

  // Sort deterministically by distance from start ascending, with ID tie-breaker
  matched.sort((a, b) => {
    if (Math.abs(a.distance_from_start_km - b.distance_from_start_km) > 0.01) {
      return a.distance_from_start_km - b.distance_from_start_km;
    }
    return a.id.localeCompare(b.id);
  });

  return matched;
}

module.exports = {
  normalizePlaceName,
  isPhoneticMatch,
  findCanonicalPlace,
  matchKnownPlacesAlongRoute
};
