const path = require("path");

const database = require(path.join(__dirname, "../../newDatabase"));
const log = require(path.join(__dirname, "../../utils/logger"));

const TABLE_NAME = "planetRuntimeState";
const SCHEMA_VERSION = 1;
const RESOURCE_RECORD_VERSION = 1;
const MAX_DISPLAY_QUALITY = 154;

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function buildResourceRecord(planetMeta, resourceTypeIDs = []) {
  const normalizedTypeIDs = normalizeResourceTypeIDs(resourceTypeIDs);
  const planetID = normalizeInteger(planetMeta && planetMeta.planetID, 0);
  const planetTypeID = normalizeInteger(planetMeta && planetMeta.typeID, 0);
  const solarSystemID = normalizeInteger(planetMeta && planetMeta.solarSystemID, 0);
  const seed = stableHash([planetID, planetTypeID, solarSystemID, "planet-resource"]);
  const qualitiesByTypeID = {};

  normalizedTypeIDs.forEach((resourceTypeID, index) => {
    qualitiesByTypeID[String(resourceTypeID)] = buildResourceQuality(
      planetMeta,
      resourceTypeID,
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

function getColony(planetID, ownerID) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedPlanetID <= 0 || normalizedOwnerID <= 0) {
    return null;
  }

  const state = readState({ repair: true });
  return state.coloniesByKey[`${normalizedPlanetID}:${normalizedOwnerID}`] || null;
}

function listColoniesForCharacter(ownerID) {
  const normalizedOwnerID = normalizeInteger(ownerID, 0);
  if (normalizedOwnerID <= 0) {
    return [];
  }

  const state = readState({ repair: true });
  return Object.values(state.coloniesByKey)
    .filter((colony) => normalizeInteger(colony && colony.ownerID, 0) === normalizedOwnerID);
}

function listColoniesForPlanet(planetID) {
  const normalizedPlanetID = normalizeInteger(planetID, 0);
  if (normalizedPlanetID <= 0) {
    return [];
  }

  const state = readState({ repair: true });
  return Object.values(state.coloniesByKey)
    .filter((colony) => normalizeInteger(colony && colony.planetID, 0) === normalizedPlanetID);
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
  getOrCreatePlanetResources,
  getColony,
  listColoniesForCharacter,
  listColoniesForPlanet,
  listLaunchesForCharacter,
  deleteLaunch,
  _testing: {
    buildResourceRecord,
    normalizeState,
    stableHash,
  },
};
