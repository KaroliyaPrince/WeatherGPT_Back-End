const { getEnvConfig } = require('../config/env');
const cacheService = require('../services/cacheService');
const {
  findCanonicalPlace,
  matchKnownPlacesAlongRoute,
  normalizePlaceName,
  isPhoneticMatch
} = require('../services/canonicalPlacesService');

const {
  geocodeLocation,
  computeGoogleRoute,
  buildRouteIndex,
  projectPointToRoute,
  sampleRouteGeometry,
  reverseGeocodeBigDataCloud,
  reverseGeocodePhoton,
  reverseGeocodeNominatim,
  queryOverpassCorridor
} = require('../services/googleRoutesService');

const { getWeatherByCoordinates } = require('../services/tomorrowService');

/**
 * Controlled-Concurrency Map Helper
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
  const limit = Math.max(1, Number(concurrencyLimit) || 3);
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Cached Geocoding Helper
 */
async function getCachedGeocode(query) {
  const cached = cacheService.getGeocode(query);
  if (cached) return cached;

  const data = await geocodeLocation(query);
  if (data) {
    cacheService.setGeocode(query, data);
  }
  return data;
}

/**
 * Cached Weather Fetching Helper
 */
async function fetchPlaceWeatherCached(place, estimatedArrivalIso) {
  const canonicalId = place.id || normalizePlaceName(place.name);
  const cached = cacheService.getWeather(canonicalId, place.latitude, place.longitude, estimatedArrivalIso);
  if (cached) {
    console.log(`[weather] place=${place.name} canonicalId=${canonicalId} cache=hit`);
    return cached;
  }

  console.log(`[weather] place=${place.name} canonicalId=${canonicalId} cache=miss`);
  const weather = await getWeatherByCoordinates(place.latitude, place.longitude, place.name);
  if (weather) {
    cacheService.setWeather(canonicalId, place.latitude, place.longitude, estimatedArrivalIso, weather);
  }
  return weather;
}

/**
 * GET /api/route-weather?source=Morbi&destination=Rajkot
 * Main Route Weather Endpoint - Deterministic Canonical Places & Weather Integration
 */
async function getRouteWeather(req, res, next) {
  const tStart = Date.now();
  const config = getEnvConfig();

  try {
    const { source, destination } = req.query;

    // STEP 1: Input Validation
    if (!source || typeof source !== 'string' || source.trim() === '' ||
        !destination || typeof destination !== 'string' || destination.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Source and destination are required'
      });
    }

    const sourceQuery = source.trim();
    const destQuery = destination.trim();

    // STEP 2: Geocode Source and Destination
    const [rawSourceInfo, rawDestInfo] = await Promise.all([
      getCachedGeocode(sourceQuery),
      getCachedGeocode(destQuery)
    ]);

    if (!rawSourceInfo) {
      return res.status(400).json({
        success: false,
        message: 'Source location could not be found'
      });
    }

    if (!rawDestInfo) {
      return res.status(400).json({
        success: false,
        message: 'Destination location could not be found'
      });
    }

    // Canonicalize Source & Destination coordinates
    const sourceCanonical = findCanonicalPlace(rawSourceInfo.name, rawSourceInfo.latitude, rawSourceInfo.longitude);
    const destCanonical = findCanonicalPlace(rawDestInfo.name, rawDestInfo.latitude, rawDestInfo.longitude);

    const sourceInfo = {
      name: sourceCanonical ? sourceCanonical.name : rawSourceInfo.name,
      latitude: sourceCanonical ? sourceCanonical.latitude : rawSourceInfo.latitude,
      longitude: sourceCanonical ? sourceCanonical.longitude : rawSourceInfo.longitude,
      canonicalId: sourceCanonical ? sourceCanonical.id : normalizePlaceName(rawSourceInfo.name)
    };

    const destInfo = {
      name: destCanonical ? destCanonical.name : rawDestInfo.name,
      latitude: destCanonical ? destCanonical.latitude : rawDestInfo.latitude,
      longitude: destCanonical ? destCanonical.longitude : rawDestInfo.longitude,
      canonicalId: destCanonical ? destCanonical.id : normalizePlaceName(rawDestInfo.name)
    };

    // STEP 3: Compute Google Driving Route & Check Place Cache
    let routeData = cacheService.getRoute(sourceInfo.name, destInfo.name, config.routeUseTraffic);
    let selectedIntermediate;

    if (routeData && routeData.selectedIntermediate) {
      selectedIntermediate = routeData.selectedIntermediate;
    } else {
      if (!routeData) {
        routeData = await computeGoogleRoute(sourceInfo, destInfo);
      }

      if (!routeData) {
        return res.status(400).json({
          success: false,
          message: 'No driving route found between the selected locations'
        });
      }

      const polylinePoints = routeData.polylinePoints || [];
      const routeIndex = buildRouteIndex(polylinePoints);
      const totalDistanceKm = routeData.distance_km;

      // STEP 5: Deterministic Route Settlement Discovery (Canonical Database + Polyline Corridor)
      // 5A. Primary Engine: Project Canonical Places Database onto route polyline
      const canonicalCandidates = matchKnownPlacesAlongRoute(routeIndex, totalDistanceKm, projectPointToRoute, {
        maxPlaceDistanceKm: config.routePlaceMaxDistanceKm,
        sourceName: sourceInfo.name,
        destName: destInfo.name,
        sourceLat: sourceInfo.latitude,
        sourceLon: sourceInfo.longitude,
        destLat: destInfo.latitude,
        destLon: destInfo.longitude
      });

      // 5B. Secondary Engine: Reverse geocoding on sampled points for fallback/gap discovery (only if canonical database lacks candidates)
      let externalRawCandidates = [];
      if (canonicalCandidates.length < 2) {
        const sampledCoords = sampleRouteGeometry(polylinePoints, config.routeSampleDistanceKm);
        const revGeocodeConcurrency = 3;

        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve([[], [], [], []]), 2000));
        const fetchPromise = Promise.all([
          mapWithConcurrency(sampledCoords, revGeocodeConcurrency, s => reverseGeocodeBigDataCloud(s.latitude, s.longitude)),
          mapWithConcurrency(sampledCoords, revGeocodeConcurrency, s => reverseGeocodePhoton(s.latitude, s.longitude)),
          mapWithConcurrency(sampledCoords, revGeocodeConcurrency, s => reverseGeocodeNominatim(s.latitude, s.longitude)),
          queryOverpassCorridor(polylinePoints)
        ]);

        const [bdcResults, photonResults, nomResults, overpassResults] = await Promise.race([fetchPromise, timeoutPromise]);
        externalRawCandidates = [
          ...(bdcResults || []).flat().filter(Boolean),
          ...(photonResults || []).flat().filter(Boolean),
          ...(nomResults || []).flat().filter(Boolean),
          ...(overpassResults || []).filter(Boolean)
        ];
      }

      // 5C. Combine & Canonicalize all discovery candidates
      const marginKm = Math.min(8.0, totalDistanceKm * 0.05);
      const candidateMap = new Map(); // key: canonicalId or normName -> place object

      // Register canonical candidates first (Highest Priority)
      for (const place of canonicalCandidates) {
        candidateMap.set(place.id, place);
        console.log(`[route-place] candidate=${place.name} canonicalMatch=${place.id} distanceFromRoute=${place.distanceFromRouteKm} distanceFromStart=${place.distance_from_start_km}`);
      }

      // Register external candidates (Normalized against Canonical Database)
      for (const cand of externalRawCandidates) {
        const canonicalMatch = findCanonicalPlace(cand.name, cand.latitude, cand.longitude);
        const placeId = canonicalMatch ? canonicalMatch.id : normalizePlaceName(cand.name);
        const placeName = canonicalMatch ? canonicalMatch.name : cand.name;

        // Skip source/destination matches
        if (placeId === sourceInfo.canonicalId || placeId === destInfo.canonicalId) continue;
        if (isPhoneticMatch(placeName, sourceInfo.name) || isPhoneticMatch(placeName, destInfo.name)) continue;

        // Always use canonical coordinates if matched!
        const placeLat = canonicalMatch ? canonicalMatch.latitude : cand.latitude;
        const placeLon = canonicalMatch ? canonicalMatch.longitude : cand.longitude;

        const proj = projectPointToRoute(placeLat, placeLon, routeIndex);
        const distFromRoute = proj.distanceFromRouteKm;
        const distFromStart = proj.distanceFromStartKm;

        if (distFromRoute <= config.routePlaceMaxDistanceKm &&
            distFromStart >= marginKm &&
            (totalDistanceKm - distFromStart) >= marginKm) {

          if (!candidateMap.has(placeId)) {
            candidateMap.set(placeId, {
              id: placeId,
              name: placeName,
              type: 'route_place',
              latitude: placeLat,           // ALWAYS CANONICAL COORDINATES WHEN MATCHED
              longitude: placeLon,         // ALWAYS CANONICAL COORDINATES WHEN MATCHED
              distance_from_start_km: distFromStart,
              distanceFromRouteKm: distFromRoute,
              placeType: canonicalMatch ? canonicalMatch.placeType : (cand.placeType || 'town'),
              rank: cand.rank || 5,
              source: cand.source || 'external'
            });

            console.log(`[route-place] candidate=${placeName} canonicalMatch=${placeId} distanceFromRoute=${distFromRoute} distanceFromStart=${distFromStart}`);
          }
        }
      }

      // 5D. Deterministic Sorting & Minimum Spacing
      const rawAccepted = Array.from(candidateMap.values());
      rawAccepted.sort((a, b) => {
        if (Math.abs(a.distance_from_start_km - b.distance_from_start_km) > 0.01) {
          return a.distance_from_start_km - b.distance_from_start_km;
        }
        return (a.id || a.name).localeCompare(b.id || b.name);
      });

      const minSpacingKm = config.minPlaceSpacingKm;
      const spacedPlaces = [];

      for (const place of rawAccepted) {
        const nearbyIdx = spacedPlaces.findIndex(x => Math.abs(x.distance_from_start_km - place.distance_from_start_km) < minSpacingKm);
        if (nearbyIdx !== -1) {
          if ((place.rank || 0) > (spacedPlaces[nearbyIdx].rank || 0)) {
            spacedPlaces[nearbyIdx] = place;
          }
        } else {
          spacedPlaces.push(place);
        }
      }

      spacedPlaces.sort((a, b) => {
        if (Math.abs(a.distance_from_start_km - b.distance_from_start_km) > 0.01) {
          return a.distance_from_start_km - b.distance_from_start_km;
        }
        return (a.id || a.name).localeCompare(b.id || b.name);
      });

      // Limit to max intermediate places deterministically
      selectedIntermediate = spacedPlaces;
      if (selectedIntermediate.length > config.maxIntermediatePlaces) {
        const step = selectedIntermediate.length / config.maxIntermediatePlaces;
        const subset = [];
        for (let i = 0; i < config.maxIntermediatePlaces; i++) {
          subset.push(selectedIntermediate[Math.floor(i * step)]);
        }
        selectedIntermediate = subset;
      }

      routeData.selectedIntermediate = selectedIntermediate;
      cacheService.setRoute(sourceInfo.name, destInfo.name, config.routeUseTraffic, routeData);
    }

    const totalDistanceKm = routeData.distance_km;
    const durationMinutes = routeData.duration_minutes;

    console.log(`[route-weather] source=${sourceInfo.name} destination=${destInfo.name} distanceKm=${totalDistanceKm} durationMin=${durationMinutes} traffic=${config.routeUseTraffic}`);

    // STEP 4: Single Departure Timestamp (ISO 8601 UTC)
    const departureTime = new Date().toISOString();

    // STEP 6: Build Final Places List (Source -> Intermediate Places -> Destination)
    const rawPlaces = [
      {
        id: sourceInfo.canonicalId,
        name: sourceInfo.name,
        type: 'source',
        latitude: sourceInfo.latitude,
        longitude: sourceInfo.longitude,
        distance_from_start_km: 0
      },
      ...selectedIntermediate.map(p => ({
        id: p.id,
        name: p.name,
        type: 'route_place',
        latitude: p.latitude,
        longitude: p.longitude,
        distance_from_start_km: p.distance_from_start_km
      })),
      {
        id: destInfo.canonicalId,
        name: destInfo.name,
        type: 'destination',
        latitude: destInfo.latitude,
        longitude: destInfo.longitude,
        distance_from_start_km: totalDistanceKm
      }
    ];

    // STEP 7: Fetch Weather & Calculate Arrival Times
    const depTimeMs = new Date(departureTime).getTime();

    const placesToFetch = rawPlaces.map(place => {
      const proportion = totalDistanceKm > 0 ? (place.distance_from_start_km / totalDistanceKm) : 0;
      const travelMinutes = Math.round(durationMinutes * proportion);
      const estimatedArrivalIso = new Date(depTimeMs + travelMinutes * 60 * 1000).toISOString();
      return { place, estimatedArrivalIso };
    });

    const placesWithWeather = await mapWithConcurrency(placesToFetch, config.weatherConcurrency, async (item) => {
      const weather = await fetchPlaceWeatherCached(item.place, item.estimatedArrivalIso);
      return {
        name: item.place.name,
        type: item.place.type,
        latitude: item.place.latitude,
        longitude: item.place.longitude,
        distance_from_start_km: item.place.distance_from_start_km,
        estimated_arrival: item.estimatedArrivalIso,
        weather
      };
    });

    // STEP 8: Identify Route Weather Alerts
    const alerts = [];
    placesWithWeather.forEach((place) => {
      const w = place.weather;
      if (!w) return;

      const rainProb = w.rain_probability ?? 0;
      const precip = w.precip_mm ?? w.precipitation_mm ?? 0;
      const windSpd = w.wind_kph ?? w.wind_speed_kph ?? 0;
      const vis = w.visibility_km;
      const code = w.weather_code ?? w.condition?.code ?? 0;

      if (rainProb >= 70 || precip >= 4) {
        alerts.push({
          type: 'heavy_rain',
          title: 'Heavy Rain Expected',
          place: place.name,
          startTime: place.estimated_arrival,
          endTime: new Date(new Date(place.estimated_arrival).getTime() + 60 * 60 * 1000).toISOString(),
          severity: 'Warning',
          description: `High probability of rainfall (${rainProb}%, ${precip}mm) expected near ${place.name}.`
        });
      } else if (windSpd >= 40) {
        alerts.push({
          type: 'strong_wind',
          title: 'Strong Wind Advisory',
          place: place.name,
          startTime: place.estimated_arrival,
          endTime: new Date(new Date(place.estimated_arrival).getTime() + 60 * 60 * 1000).toISOString(),
          severity: 'Advisory',
          description: `Gusty winds up to ${windSpd} km/h reported near ${place.name}. Drive with caution.`
        });
      } else if (vis !== null && vis <= 2) {
        alerts.push({
          type: 'low_visibility',
          title: 'Low Visibility Warning',
          place: place.name,
          startTime: place.estimated_arrival,
          endTime: new Date(new Date(place.estimated_arrival).getTime() + 60 * 60 * 1000).toISOString(),
          severity: 'Warning',
          description: `Reduced visibility (${vis} km) near ${place.name}. Reduce driving speed.`
        });
      } else if (code >= 8000) {
        alerts.push({
          type: 'thunderstorm',
          title: 'Thunderstorm Warning',
          place: place.name,
          startTime: place.estimated_arrival,
          endTime: new Date(new Date(place.estimated_arrival).getTime() + 60 * 60 * 1000).toISOString(),
          severity: 'Severe',
          description: `Thunderstorm activity detected near ${place.name}. Stay informed.`
        });
      }
    });

    console.log(`[route-weather] Complete (${Date.now() - tStart} ms). Sequence: ${placesWithWeather.map(p => `${p.name} (${p.distance_from_start_km}km)`).join(' -> ')}`);

    // STEP 9: Return Response matching existing API Contract
    return res.json({
      success: true,
      route: {
        source: {
          name: sourceInfo.name,
          latitude: sourceInfo.latitude,
          longitude: sourceInfo.longitude
        },
        destination: {
          name: destInfo.name,
          latitude: destInfo.latitude,
          longitude: destInfo.longitude
        },
        distance_km: totalDistanceKm,
        duration_minutes: durationMinutes,
        departure_time: departureTime
      },
      places: placesWithWeather,
      alerts
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getRouteWeather
};
