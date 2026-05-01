const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  currentFileTime,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const planetStaticData = require("./planetStaticData");

const TABLE_NAME = "planetRuntimeState";
const SCHEMA_VERSION = 1;
const RESOURCE_RECORD_VERSION = 2;
const RESOURCE_LAYER_VERSION = 1;
const PLANET_RESOURCE_MAX_VALUE = 1.21;
const MAX_DISPLAY_QUALITY = 154;
const LINK_TYPE_ID = 2280;
const STATE_IDLE = 0;
const STATE_ACTIVE = 1;
const HOUR_TICKS = 60 * 60 * 10000000;
const FILETIME_UNIX_EPOCH_OFFSET = 116444736000000000n;
const RADIUS_DRILL_AREA_MIN = 0.01;
const RADIUS_DRILL_AREA_MAX = 0.05;
const RADIUS_DRILL_AREA_DIFF = RADIUS_DRILL_AREA_MAX - RADIUS_DRILL_AREA_MIN;
const RESOURCE_LAYER_HOTSPOT_MIN = 6;
const RESOURCE_LAYER_HOTSPOT_SPREAD = 4;
const RESOURCE_DEPLETION_EVENT_LIMIT = 24;
const RESOURCE_DEPLETION_RECOVERY_HOURS = 96;
const RESOURCE_SH_MAX_BANDS = 30;
const RESOURCE_SH_COEFFICIENT_BYTES = 4;
const DEFAULT_ECU_TYPE_ID = 2848;

const COMMAND = Object.freeze({
  CREATEPIN: 1,
  REMOVEPIN: 2,
  CREATELINK: 3,
  REMOVELINK: 4,
  SETLINKLEVEL: 5,
  CREATEROUTE: 6,
  REMOVEROUTE: 7,
  SETSCHEMATIC: 8,
  UPGRADECOMMANDCENTER: 9,
  ADDEXTRACTORHEAD: 10,
  KILLEXTRACTORHEAD: 11,
  MOVEEXTRACTORHEAD: 12,
  INSTALLPROGRAM: 13,
});

const DEFAULT_NEXT_IDS = Object.freeze({
  pinID: 900000000000,
  routeID: 1,
  launchID: 910000000000,
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeState(rawState = {}) {
  const state = isPlainObject(rawState) ? { ...rawState } : {};
  let changed = false;

  if (state.schemaVersion !== SCHEMA_VERSION) {
    state.schemaVersion = SCHEMA_VERSION;
    changed = true;
  }

  for (const key of ["resourcesByPlanetID", "coloniesByKey", "launchesByID"]) {
    if (!isPlainObject(state[key])) {
      state[key] = {};
      changed = true;
    }
  }

  if (!isPlainObject(state.nextIDs)) {
    state.nextIDs = cloneJson(DEFAULT_NEXT_IDS);
    changed = true;
  } else {
    for (const [key, value] of Object.entries(DEFAULT_NEXT_IDS)) {
      if (!Number.isFinite(Number(state.nextIDs[key]))) {
        state.nextIDs[key] = value;
        changed = true;
      }
    }
  }

  return { state, changed };
}

function readState(options = {}) {
  const result = database.read(TABLE_NAME, "/");
  if (!result.success) {
    log.warn(
      `[PlanetRuntimeStore] Failed to read ${TABLE_NAME}: ${result.errorMsg || "READ_ERROR"}`,
    );
  }

  const { state, changed } = normalizeState(result.success ? result.data : {});
  if (changed && options.repair === true) {
    database.write(TABLE_NAME, "/", state);
  }
  return state;
}

function writeState(state) {
  const { state: normalizedState } = normalizeState(state);
  const result = database.write(TABLE_NAME, "/", normalizedState);
  if (!result.success) {
    log.warn(
      `[PlanetRuntimeStore] Failed to write ${TABLE_NAME}: ${result.errorMsg || "WRITE_ERROR"}`,
    );
  }
  return result.success === true;
}

function normalizeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function normalizeReal(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : null;
}

function currentFileTimeString() {
  return currentFileTime().toString();
}

function colonyKey(planetID, ownerID) {
  return `${normalizeInteger(planetID, 0)}:${normalizeInteger(ownerID, 0)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeResourceTypeIDs(resourceTypeIDs = []) {
  return [...new Set(
    (Array.isArray(resourceTypeIDs) ? resourceTypeIDs : [])
      .map((typeID) => normalizeInteger(typeID, 0))
      .filter((typeID) => typeID > 0),
  )].sort((left, right) => left - right);
}

function stableHash(parts = []) {
  let hash = 2166136261;
  const source = parts.map((part) => String(part)).join(":");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function hashRatio(parts = []) {
  return stableHash(parts) / 0xffffffff;
}

function signedHashRatio(parts = []) {
  return (hashRatio(parts) * 2) - 1;
}

function normalizeLongitude(value) {
  const tau = Math.PI * 2;
  const rawValue = normalizeReal(value, 0);
  const wrapped = rawValue % tau;
  return wrapped < 0 ? wrapped + tau : wrapped;
}

function normalizeLatitude(value) {
  return clamp(normalizeReal(value, 0), 0, Math.PI);
}

function normalizeSurfacePoint(latitude, longitude) {
  return {
    latitude: normalizeLatitude(latitude),
    longitude: normalizeLongitude(longitude),
  };
}

function sphericalDistance(left, right) {
  const deltaLongitude = normalizeLongitude(left.longitude - right.longitude);
  const shortestDelta = deltaLongitude > Math.PI
    ? (Math.PI * 2) - deltaLongitude
    : deltaLongitude;
  const cosineDistance = (
    Math.cos(left.latitude) * Math.cos(right.latitude) +
    Math.sin(left.latitude) * Math.sin(right.latitude) * Math.cos(shortestDelta)
  );
  return Math.acos(clamp(cosineDistance, -1, 1));
}

function filetimeToUnixMs(value, fallbackMs = Date.now()) {
  if (value === null || value === undefined || value === "") {
    return fallbackMs;
  }

  try {
    const filetime = typeof value === "bigint" ? value : BigInt(String(value));
    return Number((filetime - FILETIME_UNIX_EPOCH_OFFSET) / 10000n);
  } catch (error) {
    return fallbackMs;
  }
}

function buildResourceQuality(planetMeta, resourceTypeID, index) {
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const security = Number(planetMeta && planetMeta.security);
  const securityBonus = Number.isFinite(security)
    ? clamp(1 - security, 0, 1.25) * 22
    : 10;
  const noise = hashRatio([planetID, planetTypeID, resourceTypeID, "quality"]);
  const spread = 42 + noise * 78 + securityBonus + index * 2.5;
  return Math.round(clamp(spread, 18, MAX_DISPLAY_QUALITY));
}

function buildResourceHotspot(planetMeta, resourceTypeID, quality, index, hotspotIndex) {
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const seedParts = [
    planetID,
    planetTypeID,
    resourceTypeID,
    index,
    hotspotIndex,
    "resource-hotspot",
  ];
  const qualityScale = clamp(quality / MAX_DISPLAY_QUALITY, 0.08, 1);

  return {
    latitude: Number((hashRatio([...seedParts, "latitude"]) * Math.PI).toFixed(6)),
    longitude: Number((hashRatio([...seedParts, "longitude"]) * Math.PI * 2).toFixed(6)),
    radius: Number((0.16 + hashRatio([...seedParts, "radius"]) * 0.34).toFixed(6)),
    amplitude: Number(((0.24 + hashRatio([...seedParts, "amplitude"]) * 0.94) * qualityScale).toFixed(6)),
  };
}

function buildResourceLayer(planetMeta, resourceTypeID, quality, index) {
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const solarSystemID = normalizeInteger(planetMeta && planetMeta.solarSystemID, 0);
  const seed = stableHash([
    planetID,
    planetTypeID,
    solarSystemID,
    resourceTypeID,
    "resource-layer",
  ]);
  const qualityScale = clamp(quality / MAX_DISPLAY_QUALITY, 0.08, 1);
  const hotspotCount = RESOURCE_LAYER_HOTSPOT_MIN +
    Math.floor(hashRatio([seed, "hotspot-count"]) * RESOURCE_LAYER_HOTSPOT_SPREAD);
  const hotspots = [];
  for (let hotspotIndex = 0; hotspotIndex < hotspotCount; hotspotIndex += 1) {
    hotspots.push(buildResourceHotspot(
      planetMeta,
      resourceTypeID,
      quality,
      index,
      hotspotIndex,
    ));
  }

  return {
    version: RESOURCE_LAYER_VERSION,
    resourceTypeID,
    seed,
    quality,
    background: Number((qualityScale * (0.08 + hashRatio([seed, "background"]) * 0.08)).toFixed(6)),
    hotspots,
    depletionEvents: [],
  };
}

function normalizeResourceLayer(layer = {}) {
  const normalizedLayer = isPlainObject(layer) ? { ...layer } : {};
  normalizedLayer.version = normalizeInteger(normalizedLayer.version, 0);
  normalizedLayer.resourceTypeID = normalizeInteger(normalizedLayer.resourceTypeID, 0);
  normalizedLayer.seed = normalizeInteger(normalizedLayer.seed, 0);
  normalizedLayer.quality = normalizeInteger(normalizedLayer.quality, 0);
  normalizedLayer.background = clamp(normalizeReal(normalizedLayer.background, 0), 0, PLANET_RESOURCE_MAX_VALUE);
  normalizedLayer.hotspots = (Array.isArray(normalizedLayer.hotspots) ? normalizedLayer.hotspots : [])
    .map((hotspot) => ({
      latitude: normalizeLatitude(hotspot && hotspot.latitude),
      longitude: normalizeLongitude(hotspot && hotspot.longitude),
      radius: clamp(normalizeReal(hotspot && hotspot.radius, 0.2), 0.01, Math.PI),
      amplitude: clamp(normalizeReal(hotspot && hotspot.amplitude, 0), 0, PLANET_RESOURCE_MAX_VALUE),
    }));
  normalizedLayer.depletionEvents = (Array.isArray(normalizedLayer.depletionEvents)
    ? normalizedLayer.depletionEvents
    : [])
    .map((event) => ({
      installTime: event && event.installTime ? String(event.installTime) : null,
      expiryTime: event && event.expiryTime ? String(event.expiryTime) : null,
      headRadius: clamp(
        normalizeReal(event && event.headRadius, RADIUS_DRILL_AREA_MIN),
        RADIUS_DRILL_AREA_MIN,
        RADIUS_DRILL_AREA_MAX,
      ),
      depletionRadius: clamp(normalizeReal(event && event.depletionRadius, 0.15), 0.01, Math.PI),
      strength: clamp(normalizeReal(event && event.strength, 0), 0, PLANET_RESOURCE_MAX_VALUE),
      heads: normalizeHeads(event && event.heads),
    }))
    .filter((event) => event.strength > 0 && event.heads.length > 0);
  return normalizedLayer;
}

function buildResourceRecord(planetMeta, resourceTypeIDs = []) {
  const normalizedTypeIDs = normalizeResourceTypeIDs(resourceTypeIDs);
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const solarSystemID = normalizeInteger(planetMeta && planetMeta.solarSystemID, 0);
  const seed = stableHash([planetID, planetTypeID, solarSystemID, "planet-resource"]);
  const qualitiesByTypeID = {};
  const layersByTypeID = {};

  normalizedTypeIDs.forEach((resourceTypeID, index) => {
    const quality = buildResourceQuality(
      planetMeta,
      resourceTypeID,
      index,
    );
    qualitiesByTypeID[String(resourceTypeID)] = quality;
    layersByTypeID[String(resourceTypeID)] = buildResourceLayer(
      planetMeta,
      resourceTypeID,
      quality,
      index,
    );
  });

  return {
    version: RESOURCE_RECORD_VERSION,
    planetID,
    planetTypeID,
    solarSystemID,
    seed,
    resourceTypeIDs: normalizedTypeIDs,
    qualitiesByTypeID,
    layersByTypeID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function shouldRefreshResourceRecord(record, planetMeta, resourceTypeIDs) {
  if (!isPlainObject(record) || record.version !== RESOURCE_RECORD_VERSION) {
    return true;
  }

  const normalizedTypeIDs = normalizeResourceTypeIDs(resourceTypeIDs);
  const storedTypeIDs = normalizeResourceTypeIDs(record.resourceTypeIDs);
  if (storedTypeIDs.length !== normalizedTypeIDs.length) {
    return true;
  }

  if (!isPlainObject(record.layersByTypeID)) {
    return true;
  }

  if (normalizedTypeIDs.some((typeID) => {
    const layer = record.layersByTypeID[String(typeID)];
    return !isPlainObject(layer) || normalizeInteger(layer.version, 0) !== RESOURCE_LAYER_VERSION;
  })) {
    return true;
  }

  return normalizedTypeIDs.some((typeID, index) => storedTypeIDs[index] !== typeID) ||
    normalizeInteger(record.planetTypeID, 0) !== normalizeInteger(planetMeta && planetMeta.typeID, 0);
}

function getOrCreatePlanetResources(planetMeta, resourceTypeIDs = []) {
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  if (planetID <= 0) {
    return buildResourceRecord(planetMeta || {}, resourceTypeIDs);
  }

  const state = readState({ repair: true });
  const key = String(planetID);
  if (shouldRefreshResourceRecord(state.resourcesByPlanetID[key], planetMeta, resourceTypeIDs)) {
    const previousRecord = state.resourcesByPlanetID[key];
    const nextRecord = buildResourceRecord(planetMeta, resourceTypeIDs);
    if (previousRecord && previousRecord.createdAt) {
      nextRecord.createdAt = previousRecord.createdAt;
    }
    state.resourcesByPlanetID[key] = nextRecord;
    writeState(state);
  }

  return state.resourcesByPlanetID[key];
}

function getResourceLayerFromRecord(resourceRecord, resourceTypeID) {
  if (!isPlainObject(resourceRecord) || !isPlainObject(resourceRecord.layersByTypeID)) {
    return null;
  }
  const layer = resourceRecord.layersByTypeID[String(normalizeInteger(resourceTypeID, 0))];
  return isPlainObject(layer) ? normalizeResourceLayer(layer) : null;
}

function getResourceLayer(planetID, resourceTypeID, options = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedResourceTypeID = normalizeInteger(resourceTypeID, 0);
  if (normalizedPlanetID <= 0 || normalizedResourceTypeID <= 0) {
    return null;
  }

  const state = options.state || readState({ repair: true });
  const resourceRecord = state.resourcesByPlanetID[String(normalizedPlanetID)];
  return getResourceLayerFromRecord(resourceRecord, normalizedResourceTypeID);
}

function buildResourceLayerCoefficient(layer, coefficientIndex, options = {}) {
  const normalizedLayer = normalizeResourceLayer(layer);
  const band = Math.floor(Math.sqrt(coefficientIndex)) + 1;
  const bandStart = (band - 1) ** 2;
  const withinBand = coefficientIndex - bandStart;
  const qualityScale = clamp(normalizedLayer.quality / MAX_DISPLAY_QUALITY, 0.08, 1);

  if (coefficientIndex === 0) {
    return 64 + (qualityScale * 142);
  }

  const seed = normalizedLayer.seed || stableHash([
    normalizedLayer.resourceTypeID,
    normalizedLayer.quality,
    "resource-sh",
  ]);
  const bandDecay = 1 / (1 + (band * 0.32));
  const angleMultiplier = withinBand + 1;
  const hotspots = normalizedLayer.hotspots.length > 0
    ? normalizedLayer.hotspots
    : [{ latitude: Math.PI / 2, longitude: 0, amplitude: normalizedLayer.background || 0.1 }];
  let hotspotSignal = 0;
  for (let index = 0; index < hotspots.length; index += 1) {
    const hotspot = hotspots[index];
    const phase = (
      band * Math.cos(hotspot.latitude) +
      angleMultiplier * Math.sin(hotspot.longitude) +
      index
    );
    hotspotSignal += hotspot.amplitude * Math.cos(phase);
  }
  hotspotSignal /= Math.max(1, hotspots.length);

  let depletionSignal = 0;
  const nowMs = normalizeInteger(options.nowMs, Date.now());
  for (const event of normalizedLayer.depletionEvents) {
    const timeFactor = getDepletionEventFactor(event, nowMs);
    if (timeFactor < 0.01) {
      continue;
    }

    for (const head of event.heads) {
      const phase = (
        band * Math.cos(head[1]) +
        angleMultiplier * Math.sin(head[2])
      );
      depletionSignal += event.strength * timeFactor * Math.cos(phase);
    }
  }

  const noise = signedHashRatio([
    seed,
    normalizedLayer.resourceTypeID,
    band,
    withinBand,
    "resource-sh-coeff",
  ]);
  const coefficient = (
    (hotspotSignal * 13.5) +
    (noise * 2.25 * qualityScale) -
    (depletionSignal * 9.5)
  ) * bandDecay;
  return Number.isFinite(coefficient) ? coefficient : 0;
}

function buildResourceLayerBuffer(layer, numBands, options = {}) {
  const normalizedBands = clamp(
    normalizeInteger(numBands, 0),
    0,
    RESOURCE_SH_MAX_BANDS,
  );
  const coefficientCount = normalizedBands ** 2;
  const buffer = Buffer.alloc(coefficientCount * RESOURCE_SH_COEFFICIENT_BYTES);
  for (let coefficientIndex = 0; coefficientIndex < coefficientCount; coefficientIndex += 1) {
    buffer.writeFloatLE(
      buildResourceLayerCoefficient(layer, coefficientIndex, options),
      coefficientIndex * RESOURCE_SH_COEFFICIENT_BYTES,
    );
  }
  return buffer;
}

function getResourceDataForClient(planetMeta, resourceTypeID, resourceTypeIDs = [], info = {}) {
  const resourceRecord = getOrCreatePlanetResources(planetMeta, resourceTypeIDs);
  const layer = getResourceLayerFromRecord(resourceRecord, resourceTypeID);
  const oldBand = normalizeInteger(info.oldBand, 0);
  const requestedBand = clamp(
    normalizeInteger(info.newBand, oldBand),
    0,
    RESOURCE_SH_MAX_BANDS,
  );

  if (!layer || requestedBand <= 0) {
    return {
      data: null,
      numBands: oldBand,
      proximity: Object.prototype.hasOwnProperty.call(info, "proximity")
        ? info.proximity
        : null,
      layer,
    };
  }

  return {
    data: {
      type: "bytes",
      value: buildResourceLayerBuffer(layer, requestedBand),
    },
    numBands: requestedBand,
    proximity: Object.prototype.hasOwnProperty.call(info, "proximity")
      ? info.proximity
      : null,
    layer,
  };
}

function getDepletionEventFactor(event, nowMs = Date.now()) {
  const expiryMs = filetimeToUnixMs(event && event.expiryTime, nowMs);
  if (nowMs <= expiryMs) {
    return 1;
  }

  const hoursSinceExpiry = Math.max(0, (nowMs - expiryMs) / (60 * 60 * 1000));
  return Math.exp(-hoursSinceExpiry / RESOURCE_DEPLETION_RECOVERY_HOURS);
}

function evaluateResourceLayerValue(layer, latitude, longitude, options = {}) {
  if (!isPlainObject(layer)) {
    return 0;
  }

  const normalizedLayer = normalizeResourceLayer(layer);
  const point = normalizeSurfacePoint(latitude, longitude);
  let value = normalizedLayer.background;

  for (const hotspot of normalizedLayer.hotspots) {
    const distance = sphericalDistance(point, hotspot);
    const radius = Math.max(0.01, hotspot.radius);
    value += hotspot.amplitude * Math.exp(-(distance * distance) / (2 * radius * radius));
  }

  const nowMs = normalizeInteger(options.nowMs, Date.now());
  for (const event of normalizedLayer.depletionEvents) {
    const timeFactor = getDepletionEventFactor(event, nowMs);
    if (timeFactor < 0.01) {
      continue;
    }

    for (const head of event.heads) {
      const headPoint = normalizeSurfacePoint(head[1], head[2]);
      const distance = sphericalDistance(point, headPoint);
      const radius = Math.max(0.01, event.depletionRadius);
      value -= event.strength * timeFactor *
        Math.exp(-(distance * distance) / (2 * radius * radius));
    }
  }

  return clamp(value, 0, PLANET_RESOURCE_MAX_VALUE);
}

function evaluateResourceValueAt(planetID, resourceTypeID, latitude, longitude, options = {}) {
  const layer = getResourceLayer(planetID, resourceTypeID, options);
  return evaluateResourceLayerValue(layer, latitude, longitude, options);
}

function pruneDepletionEvents(events = [], nowMs = Date.now()) {
  return (Array.isArray(events) ? events : [])
    .map((event) => normalizeResourceLayer({ depletionEvents: [event] }).depletionEvents[0])
    .filter((event) => event && getDepletionEventFactor(event, nowMs) >= 0.01)
    .slice(-RESOURCE_DEPLETION_EVENT_LIMIT);
}

function normalizeIDTuple(value) {
  const unwrapped = unwrapMarshalValue(value);
  if (!Array.isArray(unwrapped) || unwrapped.length < 2) {
    return null;
  }

  const namespace = normalizeInteger(unwrapped[0], 0);
  const localID = normalizeInteger(unwrapped[1], 0);
  if (namespace <= 0 || localID <= 0) {
    return null;
  }
  return [namespace, localID];
}

function temporaryIDKey(value) {
  const tuple = normalizeIDTuple(value);
  if (tuple) {
    return `tmp:${tuple[0]}:${tuple[1]}`;
  }

  const normalizedID = normalizeInteger(value, 0);
  return normalizedID > 0 ? `id:${normalizedID}` : null;
}

function isTemporaryID(value, namespace = null) {
  const tuple = normalizeIDTuple(value);
  if (!tuple) {
    return false;
  }
  return namespace === null || tuple[0] === namespace;
}

function collectUsedIDs(state, fieldName) {
  const usedIDs = new Set();
  for (const colony of Object.values(state.coloniesByKey || {})) {
    for (const pin of Array.isArray(colony && colony.pins) ? colony.pins : []) {
      if (fieldName === "pinID") {
        const pinID = normalizeInteger(pin && (pin.pinID ?? pin.id), 0);
        if (pinID > 0) {
          usedIDs.add(pinID);
        }
      }
    }
    for (const route of Array.isArray(colony && colony.routes) ? colony.routes : []) {
      if (fieldName === "routeID") {
        const routeID = normalizeInteger(route && route.routeID, 0);
        if (routeID > 0) {
          usedIDs.add(routeID);
        }
      }
    }
  }
  return usedIDs;
}

function allocateNextID(state, key, usedIDs = new Set()) {
  if (!isPlainObject(state.nextIDs)) {
    state.nextIDs = cloneJson(DEFAULT_NEXT_IDS);
  }

  const fallbackID = DEFAULT_NEXT_IDS[key] || 1;
  let candidate = normalizeInteger(state.nextIDs[key], fallbackID);
  if (candidate <= 0) {
    candidate = fallbackID;
  }

  while (usedIDs.has(candidate)) {
    candidate += 1;
  }

  usedIDs.add(candidate);
  state.nextIDs[key] = candidate + 1;
  return candidate;
}

function resolveSubmittedID(value, idMap) {
  const key = temporaryIDKey(value);
  if (key && idMap.has(key)) {
    return idMap.get(key);
  }

  const normalizedID = normalizeInteger(value, 0);
  return normalizedID > 0 ? normalizedID : 0;
}

function findPin(colony, pinID) {
  const normalizedPinID = normalizeInteger(pinID, 0);
  return (Array.isArray(colony.pins) ? colony.pins : [])
    .find((pin) => normalizeInteger(pin && (pin.pinID ?? pin.id), 0) === normalizedPinID) || null;
}

function normalizeContents(contents) {
  return isPlainObject(contents) ? { ...contents } : {};
}

function normalizePin(pin = {}, ownerID = 0) {
  const pinID = normalizeInteger(pin.pinID ?? pin.id, 0);
  const typeID = normalizeInteger(pin.typeID, 0);
  const entityType = planetStaticData.getPinEntityType(typeID);
  const normalizedPin = {
    ...pin,
    id: pinID,
    pinID,
    ownerID: normalizeInteger(pin.ownerID ?? pin.charID, ownerID),
    typeID,
    latitude: normalizeReal(pin.latitude, 0),
    longitude: normalizeReal(pin.longitude, 0),
    lastRunTime: pin.lastRunTime ? String(pin.lastRunTime) : currentFileTimeString(),
    contents: normalizeContents(pin.contents),
    state: normalizeInteger(pin.state, STATE_IDLE),
  };

  if (entityType === "command" || entityType === "spaceport") {
    normalizedPin.lastLaunchTime = pin.lastLaunchTime ? String(pin.lastLaunchTime) : "0";
  }

  if (entityType === "process") {
    normalizedPin.schematicID = normalizeNullableInteger(pin.schematicID);
    normalizedPin.hasReceivedInputs = pin.hasReceivedInputs === true;
    normalizedPin.receivedInputsLastCycle = pin.receivedInputsLastCycle === true;
  }

  if (entityType === "ecu") {
    normalizedPin.cycleTime = normalizeInteger(pin.cycleTime, 0);
    normalizedPin.programType = normalizeNullableInteger(pin.programType);
    normalizedPin.qtyPerCycle = normalizeInteger(pin.qtyPerCycle, 0);
    normalizedPin.expiryTime = pin.expiryTime ? String(pin.expiryTime) : null;
    normalizedPin.installTime = pin.installTime ? String(pin.installTime) : null;
    normalizedPin.headRadius = normalizeReal(pin.headRadius, RADIUS_DRILL_AREA_MIN);
    normalizedPin.heads = (Array.isArray(pin.heads) ? pin.heads : [])
      .map((head) => (Array.isArray(head) ? head : []))
      .map((head) => [
        normalizeInteger(head[0], 0),
        normalizeReal(head[1], normalizedPin.latitude),
        normalizeReal(head[2], normalizedPin.longitude),
      ])
      .sort((left, right) => left[0] - right[0]);
  }

  return normalizedPin;
}

function buildPin(pinID, typeID, ownerID, latitude, longitude) {
  const entityType = planetStaticData.getPinEntityType(typeID);
  if (!entityType || entityType === "link") {
    throw new Error(`Invalid PI pin typeID ${typeID}`);
  }

  return normalizePin({
    id: pinID,
    pinID,
    ownerID,
    typeID,
    latitude,
    longitude,
    lastRunTime: currentFileTimeString(),
    contents: {},
    state: STATE_IDLE,
  }, ownerID);
}

function normalizeColony(rawColony, context = {}) {
  const planetID = normalizeInteger(
    context.planetID ?? (rawColony && rawColony.planetID),
    0,
  );
  const ownerID = normalizeInteger(
    context.ownerID ?? (rawColony && rawColony.ownerID),
    0,
  );
  const now = currentFileTimeString();

  const colony = isPlainObject(rawColony) ? cloneJson(rawColony) : {};
  colony.planetID = planetID;
  colony.ownerID = ownerID;
  colony.solarSystemID = normalizeInteger(
    context.solarSystemID ?? colony.solarSystemID,
    0,
  );
  colony.planetTypeID = normalizeInteger(
    context.planetTypeID ?? colony.planetTypeID ?? colony.typeID,
    0,
  );
  colony.typeID = colony.planetTypeID;
  colony.level = normalizeInteger(colony.level ?? colony.commandCenterLevel, 0);
  colony.commandCenterLevel = colony.level;
  colony.currentSimTime = colony.currentSimTime ? String(colony.currentSimTime) : now;
  colony.createdAt = colony.createdAt || new Date().toISOString();
  colony.updatedAt = colony.updatedAt || colony.createdAt;
  colony.pins = (Array.isArray(colony.pins) ? colony.pins : [])
    .map((pin) => normalizePin(pin, ownerID))
    .filter((pin) => normalizeInteger(pin.pinID, 0) > 0);
  colony.links = (Array.isArray(colony.links) ? colony.links : [])
    .map((link) => {
      const endpoints = sortEndpoints(link && link.endpoint1, link && link.endpoint2);
      return {
        ...link,
        typeID: normalizeInteger(link && link.typeID, LINK_TYPE_ID),
        endpoint1: endpoints[0],
        endpoint2: endpoints[1],
        level: normalizeInteger(link && link.level, 0),
      };
    })
    .filter((link) => link.endpoint1 > 0 && link.endpoint2 > 0 && link.endpoint1 !== link.endpoint2);
  colony.routes = (Array.isArray(colony.routes) ? colony.routes : [])
    .map((route) => ({
      ...route,
      routeID: normalizeInteger(route && route.routeID, 0),
      charID: normalizeInteger(route && (route.charID ?? route.ownerID), ownerID),
      path: (Array.isArray(route && route.path) ? route.path : [])
        .map((pinID) => normalizeInteger(pinID, 0))
        .filter((pinID) => pinID > 0),
      commodityTypeID: normalizeInteger(route && (route.commodityTypeID ?? route.typeID), 0),
      commodityQuantity: normalizeInteger(route && (route.commodityQuantity ?? route.quantity), 0),
    }))
    .filter((route) => route.routeID > 0 && route.path.length >= 2);

  return colony;
}

function sortEndpoints(endpoint1, endpoint2) {
  const left = normalizeInteger(endpoint1, 0);
  const right = normalizeInteger(endpoint2, 0);
  return left <= right ? [left, right] : [right, left];
}

function linkKey(endpoint1, endpoint2) {
  return sortEndpoints(endpoint1, endpoint2).join(":");
}

function removeRoutesTouchingPin(colony, pinID) {
  const normalizedPinID = normalizeInteger(pinID, 0);
  colony.routes = (Array.isArray(colony.routes) ? colony.routes : [])
    .filter((route) => !(Array.isArray(route.path) && route.path.includes(normalizedPinID)));
}

function routeUsesLink(route, endpoint1, endpoint2) {
  const targetKey = linkKey(endpoint1, endpoint2);
  const path = Array.isArray(route && route.path) ? route.path : [];
  for (let index = 0; index < path.length - 1; index += 1) {
    if (linkKey(path[index], path[index + 1]) === targetKey) {
      return true;
    }
  }
  return false;
}

function removeRoutesTouchingLink(colony, endpoint1, endpoint2) {
  colony.routes = (Array.isArray(colony.routes) ? colony.routes : [])
    .filter((route) => !routeUsesLink(route, endpoint1, endpoint2));
}

function setExtractorHead(pin, headID, latitude, longitude) {
  if (!pin) {
    return;
  }
  const normalizedHeadID = normalizeInteger(headID, 0);
  pin.heads = (Array.isArray(pin.heads) ? pin.heads : [])
    .filter((head) => normalizeInteger(head && head[0], 0) !== normalizedHeadID);
  pin.heads.push([
    normalizedHeadID,
    normalizeReal(latitude, pin.latitude),
    normalizeReal(longitude, pin.longitude),
  ]);
  pin.heads.sort((left, right) => left[0] - right[0]);
}

function removeExtractorHead(pin, headID) {
  if (!pin) {
    return;
  }
  const normalizedHeadID = normalizeInteger(headID, 0);
  pin.heads = (Array.isArray(pin.heads) ? pin.heads : [])
    .filter((head) => normalizeInteger(head && head[0], 0) !== normalizedHeadID);
}

function getProgramLengthFromHeadRadius(headRadius) {
  return (
    (clamp(headRadius, RADIUS_DRILL_AREA_MIN, RADIUS_DRILL_AREA_MAX) - RADIUS_DRILL_AREA_MIN) /
    RADIUS_DRILL_AREA_DIFF *
    335 +
    1
  );
}

function getCycleTimeFromProgramLength(programLength) {
  return 0.25 * 2 ** Math.max(0, Math.floor(Math.log2(programLength / 25.0)) + 1);
}

function normalizeHeads(heads = []) {
  return (Array.isArray(heads) ? heads : [])
    .map((head) => (Array.isArray(head) ? head : []))
    .map((head) => [
      normalizeInteger(head[0], 0),
      normalizeReal(head[1], 0),
      normalizeReal(head[2], 0),
    ]);
}

function getEcuAttribute(ecuTypeID, attributeID, fallback) {
  const normalizedTypeID = normalizeInteger(ecuTypeID, DEFAULT_ECU_TYPE_ID);
  const value = planetStaticData.getTypeAttribute(normalizedTypeID, attributeID, fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getEcuMaxVolume(ecuTypeID) {
  return Math.max(
    1,
    getEcuAttribute(
      ecuTypeID,
      planetStaticData.ATTRIBUTE.PIN_EXTRACTION_QUANTITY,
      1000,
    ),
  );
}

function getCircleOverlapRatio(distance, radius) {
  const safeRadius = Math.max(0.0001, radius);
  if (distance >= safeRadius * 2) {
    return 0;
  }
  if (distance <= 0) {
    return 1;
  }

  const radiusSquared = safeRadius ** 2;
  const overlapArea = (
    2 * radiusSquared * Math.acos(0.5 * (distance / safeRadius)) -
    0.5 * distance * Math.sqrt(Math.max(0, (4 * radiusSquared) - (distance ** 2)))
  );
  return clamp(overlapArea / (Math.PI * radiusSquared), 0, 1);
}

function getOwnHeadModifiers(heads, headRadius, overlapFactor) {
  const modifiers = new Map(heads.map((head) => [normalizeInteger(head[0], 0), 1]));
  for (let leftIndex = 0; leftIndex < heads.length; leftIndex += 1) {
    const left = heads[leftIndex];
    const leftPoint = normalizeSurfacePoint(left[1], left[2]);
    for (let rightIndex = leftIndex + 1; rightIndex < heads.length; rightIndex += 1) {
      const right = heads[rightIndex];
      const rightPoint = normalizeSurfacePoint(right[1], right[2]);
      const distance = sphericalDistance(leftPoint, rightPoint);
      const overlap = getCircleOverlapRatio(distance, headRadius);
      if (overlap <= 0) {
        continue;
      }

      const modifier = clamp(1 - (overlap * overlapFactor), 0, 1);
      const leftID = normalizeInteger(left[0], 0);
      const rightID = normalizeInteger(right[0], 0);
      modifiers.set(leftID, (modifiers.get(leftID) || 1) * modifier);
      modifiers.set(rightID, (modifiers.get(rightID) || 1) * modifier);
    }
  }
  return modifiers;
}

function getFallbackResourceValue(planetID, resourceTypeID, head, quality) {
  const qualityValue = clamp(quality / MAX_DISPLAY_QUALITY, 0.08, 1);
  const noise = hashRatio([
    planetID,
    resourceTypeID,
    head[0],
    head[1],
    head[2],
    "fallback-resource-head",
  ]);
  return clamp((qualityValue * 0.72) + (noise * 0.22), 0, PLANET_RESOURCE_MAX_VALUE);
}

function estimateProgramResult({
  planetID = 0,
  resourceTypeID = 0,
  heads = [],
  headRadius = RADIUS_DRILL_AREA_MIN,
  ecuTypeID = DEFAULT_ECU_TYPE_ID,
  state = null,
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedResourceTypeID = normalizeInteger(resourceTypeID, 0);
  if (normalizedResourceTypeID <= 0) {
    return {
      qtyToDistribute: 0,
      cycleTime: 0,
      numCycles: 0,
    };
  }

  const normalizedHeads = normalizeHeads(heads);
  const clampedRadius = clamp(
    normalizeReal(headRadius, RADIUS_DRILL_AREA_MIN),
    RADIUS_DRILL_AREA_MIN,
    RADIUS_DRILL_AREA_MAX,
  );
  const programLength = getProgramLengthFromHeadRadius(clampedRadius);
  const cycleTimeHours = getCycleTimeFromProgramLength(programLength);
  const cycleTime = Math.max(1, Math.trunc(cycleTimeHours * HOUR_TICKS));
  const numCycles = Math.max(1, Math.trunc(programLength / cycleTimeHours));

  const sourceState = state || readState({ repair: true });
  const resourceRecord = sourceState.resourcesByPlanetID[String(normalizedPlanetID)] || {};
  const layer = getResourceLayerFromRecord(resourceRecord, normalizedResourceTypeID);
  const quality = normalizeInteger(
    resourceRecord.qualitiesByTypeID &&
      resourceRecord.qualitiesByTypeID[String(normalizedResourceTypeID)],
    65,
  );
  const overlapFactor = clamp(
    getEcuAttribute(ecuTypeID, planetStaticData.ATTRIBUTE.ECU_OVERLAP_FACTOR, 0.5),
    0,
    1,
  );
  const maxVolume = getEcuMaxVolume(ecuTypeID);
  const headModifiers = getOwnHeadModifiers(normalizedHeads, clampedRadius, overlapFactor);
  const summedHeadValue = normalizedHeads.reduce((total, head) => {
    const resourceValue = layer
      ? evaluateResourceLayerValue(layer, head[1], head[2])
      : getFallbackResourceValue(
        normalizedPlanetID,
        normalizedResourceTypeID,
        head,
        quality,
      );
    const modifier = headModifiers.get(normalizeInteger(head[0], 0)) || 1;
    return total + (resourceValue * modifier);
  }, 0);
  const qtyToDistribute = Math.max(1, Math.trunc(maxVolume * summedHeadValue));

  return {
    qtyToDistribute,
    cycleTime,
    numCycles,
  };
}

function recordResourceDepletionEvent({
  state,
  planetID,
  resourceTypeID,
  heads = [],
  headRadius = RADIUS_DRILL_AREA_MIN,
  ecuTypeID = DEFAULT_ECU_TYPE_ID,
  result = {},
  installTime = null,
  expiryTime = null,
} = {}) {
  if (!state || !isPlainObject(state.resourcesByPlanetID)) {
    return;
  }

  const resourceRecord = state.resourcesByPlanetID[String(normalizeInteger(planetID, 0))];
  if (!isPlainObject(resourceRecord) || !isPlainObject(resourceRecord.layersByTypeID)) {
    return;
  }

  const layerKey = String(normalizeInteger(resourceTypeID, 0));
  const layer = resourceRecord.layersByTypeID[layerKey];
  if (!isPlainObject(layer)) {
    return;
  }

  const normalizedHeads = normalizeHeads(heads);
  if (normalizedHeads.length < 1) {
    return;
  }

  const normalizedHeadRadius = clamp(
    normalizeReal(headRadius, RADIUS_DRILL_AREA_MIN),
    RADIUS_DRILL_AREA_MIN,
    RADIUS_DRILL_AREA_MAX,
  );
  const depletionRange = Math.max(
    1,
    getEcuAttribute(
      ecuTypeID,
      planetStaticData.ATTRIBUTE.EXTRACTOR_DEPLETION_RANGE,
      5,
    ),
  );
  const depletionRate = Math.max(
    0.1,
    getEcuAttribute(
      ecuTypeID,
      planetStaticData.ATTRIBUTE.EXTRACTOR_DEPLETION_RATE,
      1,
    ),
  );
  const maxVolume = getEcuMaxVolume(ecuTypeID);
  const pressurePerHead = normalizeInteger(result.qtyToDistribute, 0) /
    Math.max(1, maxVolume * normalizedHeads.length);
  const strength = clamp(pressurePerHead * 0.16 * depletionRate, 0.01, 0.2);
  const depletionRadius = clamp(
    normalizedHeadRadius * depletionRange,
    normalizedHeadRadius,
    0.45,
  );

  layer.depletionEvents = pruneDepletionEvents(layer.depletionEvents);
  layer.depletionEvents.push({
    installTime: installTime ? String(installTime) : currentFileTimeString(),
    expiryTime: expiryTime ? String(expiryTime) : currentFileTimeString(),
    headRadius: normalizedHeadRadius,
    depletionRadius,
    strength: Number(strength.toFixed(6)),
    heads: normalizedHeads,
  });
  layer.depletionEvents = pruneDepletionEvents(layer.depletionEvents);
  resourceRecord.updatedAt = new Date().toISOString();
}

function installECUProgram(pin, programTypeID, headRadius, context = {}) {
  const normalizedProgramTypeID = normalizeNullableInteger(programTypeID);
  if (!normalizedProgramTypeID) {
    pin.cycleTime = 0;
    pin.programType = null;
    pin.qtyPerCycle = 0;
    pin.expiryTime = null;
    pin.installTime = null;
    pin.headRadius = normalizeReal(headRadius, pin.headRadius || RADIUS_DRILL_AREA_MIN);
    pin.state = STATE_IDLE;
    return;
  }

  const result = estimateProgramResult({
    planetID: context.planetID,
    resourceTypeID: normalizedProgramTypeID,
    heads: pin.heads,
    headRadius,
    ecuTypeID: pin.typeID,
    state: context.state,
  });
  const installTime = currentFileTimeString();
  const expiryTime = (
    BigInt(installTime) +
    BigInt(result.cycleTime) * BigInt(result.numCycles)
  ).toString();

  pin.cycleTime = result.cycleTime;
  pin.programType = normalizedProgramTypeID;
  pin.qtyPerCycle = result.qtyToDistribute;
  pin.expiryTime = expiryTime;
  pin.installTime = installTime;
  pin.lastRunTime = installTime;
  pin.headRadius = clamp(
    normalizeReal(headRadius, RADIUS_DRILL_AREA_MIN),
    RADIUS_DRILL_AREA_MIN,
    RADIUS_DRILL_AREA_MAX,
  );
  pin.state = STATE_ACTIVE;

  recordResourceDepletionEvent({
    state: context.state,
    planetID: context.planetID,
    resourceTypeID: normalizedProgramTypeID,
    heads: pin.heads,
    headRadius: pin.headRadius,
    ecuTypeID: pin.typeID,
    result,
    installTime,
    expiryTime,
  });
}

function normalizeCommandStream(serializedChanges = []) {
  const stream = unwrapMarshalValue(serializedChanges);
  if (!Array.isArray(stream)) {
    return [];
  }

  return stream
    .map((entry) => {
      const unwrappedEntry = unwrapMarshalValue(entry);
      if (Array.isArray(unwrappedEntry)) {
        const args = Array.isArray(unwrappedEntry[1])
          ? unwrappedEntry[1]
          : [unwrappedEntry[1]].filter((value) => value !== undefined);
        return {
          id: normalizeInteger(unwrappedEntry[0], 0),
          args,
        };
      }

      if (isPlainObject(unwrappedEntry)) {
        const args = Array.isArray(unwrappedEntry.args)
          ? unwrappedEntry.args
          : Array.isArray(unwrappedEntry.argTuple)
            ? unwrappedEntry.argTuple
            : [];
        return {
          id: normalizeInteger(unwrappedEntry.id ?? unwrappedEntry.commandID, 0),
          args,
        };
      }

      return null;
    })
    .filter((entry) => entry && entry.id > 0);
}

function ensurePinsExist(colony, pinIDs = []) {
  for (const pinID of pinIDs) {
    if (!findPin(colony, pinID)) {
      throw new Error(`Invalid PI command references missing pin ${pinID}`);
    }
  }
}

function upsertLink(colony, endpoint1, endpoint2, level) {
  const endpoints = sortEndpoints(endpoint1, endpoint2);
  if (endpoints[0] <= 0 || endpoints[1] <= 0 || endpoints[0] === endpoints[1]) {
    return;
  }
  ensurePinsExist(colony, endpoints);
  const key = linkKey(endpoints[0], endpoints[1]);
  colony.links = (Array.isArray(colony.links) ? colony.links : [])
    .filter((link) => linkKey(link.endpoint1, link.endpoint2) !== key);
  colony.links.push({
    typeID: LINK_TYPE_ID,
    endpoint1: endpoints[0],
    endpoint2: endpoints[1],
    level: Math.max(0, normalizeInteger(level, 0)),
  });
  colony.links.sort((left, right) => (
    left.endpoint1 === right.endpoint1
      ? left.endpoint2 - right.endpoint2
      : left.endpoint1 - right.endpoint1
  ));
}

function applyUserUpdateNetwork({
  planetID,
  ownerID,
  solarSystemID = 0,
  planetTypeID = 0,
  serializedChanges = [],
  commands = null,
} = {}) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0) {
    throw new Error("Cannot update PI network without a planet and owner");
  }

  const commandStream = normalizeCommandStream(commands || serializedChanges);
  const state = readState({ repair: true });
  const key = colonyKey(normalizedPlanetID, normalizedOwnerID);
  const colony = normalizeColony(state.coloniesByKey[key], {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
    solarSystemID,
    planetTypeID,
  });
  const idMap = new Map();
  const usedPinIDs = collectUsedIDs(state, "pinID");
  const usedRouteIDs = collectUsedIDs(state, "routeID");

  for (const command of commandStream) {
    const args = Array.isArray(command.args) ? command.args : [];

    switch (command.id) {
      case COMMAND.CREATEPIN: {
        const submittedPinID = args[0];
        const typeID = normalizeInteger(args[1], 0);
        const pinID = isTemporaryID(submittedPinID, 1)
          ? allocateNextID(state, "pinID", usedPinIDs)
          : normalizeInteger(submittedPinID, 0);
        if (pinID <= 0) {
          throw new Error("CREATEPIN requires a valid pin ID");
        }
        const submittedKey = temporaryIDKey(submittedPinID);
        if (submittedKey) {
          idMap.set(submittedKey, pinID);
        }

        const entityType = planetStaticData.getPinEntityType(typeID);
        if (entityType === "command") {
          const existingCommandPin = colony.pins.find((pin) => (
            normalizeInteger(pin.pinID, 0) !== pinID &&
            planetStaticData.getPinEntityType(pin.typeID) === "command"
          ));
          if (existingCommandPin) {
            throw new Error("Cannot build multiple PI command centers on one planet");
          }
        }

        colony.pins = colony.pins.filter((pin) => normalizeInteger(pin.pinID, 0) !== pinID);
        colony.pins.push(buildPin(
          pinID,
          typeID,
          normalizedOwnerID,
          normalizeReal(args[2], 0),
          normalizeReal(args[3], 0),
        ));
        colony.pins.sort((left, right) => normalizeInteger(left.pinID, 0) - normalizeInteger(right.pinID, 0));
        break;
      }

      case COMMAND.REMOVEPIN: {
        const pinID = resolveSubmittedID(args[0], idMap);
        colony.pins = colony.pins.filter((pin) => normalizeInteger(pin.pinID, 0) !== pinID);
        colony.links = colony.links.filter((link) => (
          normalizeInteger(link.endpoint1, 0) !== pinID &&
          normalizeInteger(link.endpoint2, 0) !== pinID
        ));
        removeRoutesTouchingPin(colony, pinID);
        break;
      }

      case COMMAND.CREATELINK: {
        upsertLink(
          colony,
          resolveSubmittedID(args[0], idMap),
          resolveSubmittedID(args[1], idMap),
          args[2],
        );
        break;
      }

      case COMMAND.REMOVELINK: {
        const endpoints = sortEndpoints(
          resolveSubmittedID(args[0], idMap),
          resolveSubmittedID(args[1], idMap),
        );
        const keyToRemove = linkKey(endpoints[0], endpoints[1]);
        colony.links = colony.links.filter((link) => linkKey(link.endpoint1, link.endpoint2) !== keyToRemove);
        removeRoutesTouchingLink(colony, endpoints[0], endpoints[1]);
        break;
      }

      case COMMAND.SETLINKLEVEL: {
        upsertLink(
          colony,
          resolveSubmittedID(args[0], idMap),
          resolveSubmittedID(args[1], idMap),
          args[2],
        );
        break;
      }

      case COMMAND.CREATEROUTE: {
        const submittedRouteID = args[0];
        const routeID = isTemporaryID(submittedRouteID, 2)
          ? allocateNextID(state, "routeID", usedRouteIDs)
          : normalizeInteger(submittedRouteID, 0);
        if (routeID <= 0) {
          throw new Error("CREATEROUTE requires a valid route ID");
        }
        const submittedKey = temporaryIDKey(submittedRouteID);
        if (submittedKey) {
          idMap.set(submittedKey, routeID);
        }

        const path = (Array.isArray(args[1]) ? args[1] : [])
          .map((pinID) => resolveSubmittedID(pinID, idMap))
          .filter((pinID) => pinID > 0);
        ensurePinsExist(colony, path);
        colony.routes = colony.routes.filter((route) => normalizeInteger(route.routeID, 0) !== routeID);
        colony.routes.push({
          routeID,
          charID: normalizedOwnerID,
          path,
          commodityTypeID: normalizeInteger(args[2], 0),
          commodityQuantity: normalizeInteger(args[3], 0),
        });
        colony.routes.sort((left, right) => normalizeInteger(left.routeID, 0) - normalizeInteger(right.routeID, 0));
        break;
      }

      case COMMAND.REMOVEROUTE: {
        const routeID = resolveSubmittedID(args[0], idMap);
        colony.routes = colony.routes.filter((route) => normalizeInteger(route.routeID, 0) !== routeID);
        break;
      }

      case COMMAND.SETSCHEMATIC: {
        const pin = findPin(colony, resolveSubmittedID(args[0], idMap));
        if (pin) {
          pin.schematicID = normalizeNullableInteger(args[1]);
          pin.hasReceivedInputs = false;
          pin.receivedInputsLastCycle = false;
        }
        break;
      }

      case COMMAND.UPGRADECOMMANDCENTER: {
        const pin = findPin(colony, resolveSubmittedID(args[0], idMap));
        const level = clamp(normalizeInteger(args[1], 0), 0, 5);
        if (!pin || planetStaticData.getPinEntityType(pin.typeID) === "command") {
          colony.level = level;
          colony.commandCenterLevel = level;
        }
        break;
      }

      case COMMAND.ADDEXTRACTORHEAD: {
        setExtractorHead(
          findPin(colony, resolveSubmittedID(args[0], idMap)),
          args[1],
          args[2],
          args[3],
        );
        break;
      }

      case COMMAND.KILLEXTRACTORHEAD: {
        removeExtractorHead(
          findPin(colony, resolveSubmittedID(args[0], idMap)),
          args[1],
        );
        break;
      }

      case COMMAND.MOVEEXTRACTORHEAD: {
        setExtractorHead(
          findPin(colony, resolveSubmittedID(args[0], idMap)),
          args[1],
          args[2],
          args[3],
        );
        break;
      }

      case COMMAND.INSTALLPROGRAM: {
        const pin = findPin(colony, resolveSubmittedID(args[0], idMap));
        if (pin) {
          installECUProgram(pin, args[1], args[2], {
            planetID: normalizedPlanetID,
            state,
          });
        }
        break;
      }

      default:
        log.warn(`[PlanetRuntimeStore] Ignoring unsupported PI command ${command.id}`);
        break;
    }
  }

  colony.currentSimTime = currentFileTimeString();
  colony.updatedAt = new Date().toISOString();
  state.coloniesByKey[key] = normalizeColony(colony, {
    planetID: normalizedPlanetID,
    ownerID: normalizedOwnerID,
    solarSystemID,
    planetTypeID,
  });
  writeState(state);
  return state.coloniesByKey[key];
}

function abandonColony(planetID, ownerID) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0) {
    return false;
  }

  const state = readState({ repair: true });
  delete state.coloniesByKey[colonyKey(normalizedPlanetID, normalizedOwnerID)];
  writeState(state);
  return true;
}

function getColony(planetID, ownerID) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0) {
    return null;
  }

  const state = readState({ repair: true });
  const colony = state.coloniesByKey[colonyKey(normalizedPlanetID, normalizedOwnerID)];
  return colony ? normalizeColony(colony, { planetID: normalizedPlanetID, ownerID: normalizedOwnerID }) : null;
}

function listColoniesForCharacter(ownerID) {
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedOwnerID <= 0) {
    return [];
  }

  const state = readState({ repair: true });
  return Object.values(state.coloniesByKey)
    .filter((colony) => normalizeInteger(colony && colony.ownerID, 0) === normalizedOwnerID)
    .map((colony) => normalizeColony(colony, {
      planetID: colony && colony.planetID,
      ownerID: normalizedOwnerID,
    }));
}

function listColoniesForPlanet(planetID) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  if (normalizedPlanetID <= 0) {
    return [];
  }

  const state = readState({ repair: true });
  return Object.values(state.coloniesByKey)
    .filter((colony) => normalizeInteger(colony && colony.planetID, 0) === normalizedPlanetID)
    .map((colony) => normalizeColony(colony, {
      planetID: normalizedPlanetID,
      ownerID: colony && colony.ownerID,
    }));
}

function listLaunchesForCharacter(ownerID) {
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedOwnerID <= 0) {
    return [];
  }

  const state = readState({ repair: true });
  return Object.values(state.launchesByID)
    .filter((launch) => (
      normalizeInteger(launch && launch.ownerID, 0) === normalizedOwnerID &&
      launch.deleted !== true
    ));
}

function deleteLaunch(launchID, ownerID = 0) {
  const normalizedLaunchID = normalizeInteger(launchID, 0);
  if (normalizedLaunchID <= 0) {
    return false;
  }

  const state = readState({ repair: true });
  const launch = state.launchesByID[String(normalizedLaunchID)];
  if (!launch) {
    return true;
  }

  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (
    normalizedOwnerID > 0 &&
    normalizeInteger(launch.ownerID, 0) > 0 &&
    normalizeInteger(launch.ownerID, 0) !== normalizedOwnerID
  ) {
    return false;
  }

  launch.deleted = true;
  launch.deletedAt = new Date().toISOString();
  writeState(state);
  return true;
}

module.exports = {
  TABLE_NAME,
  SCHEMA_VERSION,
  DEFAULT_NEXT_IDS,
  COMMAND,
  LINK_TYPE_ID,
  PLANET_RESOURCE_MAX_VALUE,
  getOrCreatePlanetResources,
  getResourceDataForClient,
  getResourceLayer,
  evaluateResourceValueAt,
  getColony,
  listColoniesForCharacter,
  listColoniesForPlanet,
  listLaunchesForCharacter,
  deleteLaunch,
  applyUserUpdateNetwork,
  abandonColony,
  estimateProgramResult,
  _testing: {
    buildPin,
    buildResourceRecord,
    buildResourceLayer,
    evaluateResourceLayerValue,
    normalizeCommandStream,
    normalizeColony,
    normalizeResourceLayer,
    normalizeState,
    stableHash,
  },
};
