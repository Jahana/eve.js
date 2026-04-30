const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  buildBoundObjectResponse,
  buildDict,
  buildKeyVal,
  buildList,
  currentFileTime,
  normalizeNumber,
  resolveBoundNodeId,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const planetRuntimeStore = require("./planetRuntimeStore");

let planetMetaCache = null;
let itemTypeGroupCache = null;

const GROUP_COMMAND_PINS = 1027;
const GROUP_EXTRACTOR_CONTROL_UNITS = 1063;

const RESOURCE_TYPE = Object.freeze({
  MICROORGANISMS: 2073,
  BASE_METALS: 2267,
  AQUEOUS_LIQUIDS: 2268,
  NOBLE_METALS: 2270,
  HEAVY_METALS: 2272,
  PLANKTIC_COLONIES: 2286,
  COMPLEX_ORGANISMS: 2287,
  CARBON_COMPOUNDS: 2288,
  AUTOTROPHS: 2305,
  NON_CS_CRYSTALS: 2306,
  FELSIC_MAGMA: 2307,
  SUSPENDED_PLASMA: 2308,
  IONIC_SOLUTIONS: 2309,
  NOBLE_GAS: 2310,
  REACTIVE_GAS: 2311,
});

const PLANET_RESOURCES_BY_TYPE_ID = Object.freeze({
  // Planet (Temperate)
  11: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.AUTOTROPHS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.COMPLEX_ORGANISMS,
    RESOURCE_TYPE.MICROORGANISMS,
  ],
  // Planet (Ice)
  12: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.PLANKTIC_COLONIES,
  ],
  // Planet (Gas)
  13: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.IONIC_SOLUTIONS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.REACTIVE_GAS,
  ],
  // Planet (Oceanic)
  2014: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.COMPLEX_ORGANISMS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.PLANKTIC_COLONIES,
  ],
  // Planet (Lava)
  2015: [
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.FELSIC_MAGMA,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.NON_CS_CRYSTALS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  // Planet (Barren)
  2016: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_METALS,
  ],
  // Planet (Storm)
  2017: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.IONIC_SOLUTIONS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  // Planet (Plasma)
  2063: [
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.NOBLE_METALS,
    RESOURCE_TYPE.NON_CS_CRYSTALS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  // Modern duplicate surface/background planet type IDs.
  56018: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_METALS,
  ],
  56019: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.PLANKTIC_COLONIES,
  ],
  56020: [
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.FELSIC_MAGMA,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.NON_CS_CRYSTALS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  56021: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.COMPLEX_ORGANISMS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.PLANKTIC_COLONIES,
  ],
  56022: [
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.HEAVY_METALS,
    RESOURCE_TYPE.NOBLE_METALS,
    RESOURCE_TYPE.NON_CS_CRYSTALS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  56023: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.AUTOTROPHS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.COMPLEX_ORGANISMS,
    RESOURCE_TYPE.MICROORGANISMS,
  ],
  56024: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.IONIC_SOLUTIONS,
    RESOURCE_TYPE.NOBLE_GAS,
    RESOURCE_TYPE.SUSPENDED_PLASMA,
  ],
  73911: [
    RESOURCE_TYPE.AQUEOUS_LIQUIDS,
    RESOURCE_TYPE.BASE_METALS,
    RESOURCE_TYPE.CARBON_COMPOUNDS,
    RESOURCE_TYPE.MICROORGANISMS,
    RESOURCE_TYPE.NOBLE_METALS,
  ],
});

function toInt(value, fallback = 0) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.trunc(numericValue);
}

function getCharacterColonies(characterRecord = {}) {
  const candidates = [
    characterRecord.colonies,
    characterRecord.planets,
    characterRecord.planetColonies,
  ];
  const source = candidates.find((entry) => Array.isArray(entry));
  return Array.isArray(source) ? source.filter(Boolean) : [];
}

function getPlanetMetaByID() {
  if (planetMetaCache) {
    return planetMetaCache;
  }

  planetMetaCache = new Map();
  for (const row of readStaticRows(TABLE.CELESTIALS)) {
    if (!row || (row.kind !== "planet" && row.groupName !== "Planet")) {
      continue;
    }
    const itemID = toInt(row.itemID, 0);
    if (itemID <= 0) {
      continue;
    }
    planetMetaCache.set(itemID, {
      planetID: itemID,
      solarSystemID: toInt(row.solarSystemID, 0),
      typeID: toInt(row.typeID, 0),
      celestialIndex: toInt(row.celestialIndex, 0),
      radius: toInt(row.radius, 0),
      security: Number(row.security),
      itemName: row.itemName || "",
    });
  }

  return planetMetaCache;
}

function getPlanetMeta(planetID) {
  const normalizedPlanetID = toInt(planetID, 0);
  return getPlanetMetaByID().get(normalizedPlanetID) || {
    planetID: normalizedPlanetID,
    solarSystemID: 0,
    typeID: 0,
    celestialIndex: 0,
    radius: 0,
    security: 0,
    itemName: "",
  };
}

function getItemTypeGroupID(typeID) {
  const normalizedTypeID = toInt(typeID, 0);
  if (normalizedTypeID <= 0) {
    return 0;
  }

  if (!itemTypeGroupCache) {
    itemTypeGroupCache = new Map();
    for (const row of readStaticRows(TABLE.ITEM_TYPES)) {
      const rowTypeID = toInt(row.typeID ?? row._key, 0);
      if (rowTypeID > 0) {
        itemTypeGroupCache.set(rowTypeID, toInt(row.groupID, 0));
      }
    }
  }

  return itemTypeGroupCache.get(normalizedTypeID) || 0;
}

function getResourceTypeIDsForPlanetType(planetTypeID) {
  return PLANET_RESOURCES_BY_TYPE_ID[toInt(planetTypeID, 0)] || [];
}

function mergeColonies(primaryColonies = [], extraColonies = []) {
  const merged = new Map();
  for (const entry of [...primaryColonies, ...extraColonies]) {
    const planetID = toInt(entry && (entry.planetID ?? entry.itemID ?? entry.id), 0);
    if (planetID > 0) {
      merged.set(planetID, entry);
    }
  }
  return [...merged.values()];
}

function buildPlanetEntry(entry = {}) {
  const planetID = toInt(entry.planetID ?? entry.itemID ?? entry.id, 0);
  if (planetID <= 0) {
    return null;
  }

  const staticMeta = getPlanetMetaByID().get(planetID) || {};
  const pins = Array.isArray(entry.pins) ? entry.pins : [];

  return buildKeyVal([
    ["planetID", planetID],
    [
      "solarSystemID",
      toInt(entry.solarSystemID ?? entry.systemID, staticMeta.solarSystemID || 0),
    ],
    ["typeID", toInt(entry.typeID ?? entry.planetTypeID, staticMeta.typeID || 0)],
    [
      "numberOfPins",
      toInt(entry.numberOfPins ?? entry.pinCount, pins.length),
    ],
    [
      "celestialIndex",
      toInt(entry.celestialIndex, staticMeta.celestialIndex || 0),
    ],
    [
      "commandCenterLevel",
      toInt(
        entry.commandCenterLevel ??
          entry.colonyLevel ??
          entry.commandCenterUpgradeLevel,
        0,
      ),
    ],
  ]);
}

function buildPlanetListForCharacter(characterRecord = {}) {
  return buildList(
    mergeColonies(
      getCharacterColonies(characterRecord),
      characterRecord.runtimeColonies,
    )
      .map((entry) => buildPlanetEntry(entry))
      .filter(Boolean),
  );
}

function marshalPlainValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return buildList(value.map((entry) => marshalPlainValue(entry)));
  }

  if (value && typeof value === "object") {
    if (value.type && typeof value.type === "string") {
      return value;
    }
    return buildDict(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        marshalPlainValue(entryValue),
      ]),
    );
  }

  return value;
}

function buildKeyValFromObject(value = {}) {
  return buildKeyVal(
    Object.entries(value || {}).map(([entryKey, entryValue]) => [
      entryKey,
      marshalPlainValue(entryValue),
    ]),
  );
}

function buildPinRow(pin = {}) {
  const pinID = toInt(pin.pinID ?? pin.id, 0);
  const row = {
    ...pin,
    id: toInt(pin.id ?? pinID, pinID),
    pinID,
    ownerID: toInt(pin.ownerID ?? pin.charID, 0),
    typeID: toInt(pin.typeID, 0),
    latitude: Number(pin.latitude) || 0,
    longitude: Number(pin.longitude) || 0,
  };
  return buildKeyValFromObject(row);
}

function buildLinkRow(link = {}) {
  return buildKeyValFromObject({
    ...link,
    endpoint1: toInt(link.endpoint1, 0),
    endpoint2: toInt(link.endpoint2, 0),
    level: toInt(link.level, 0),
    typeID: toInt(link.typeID, 0),
  });
}

function buildRouteRow(route = {}) {
  return buildKeyValFromObject({
    ...route,
    routeID: toInt(route.routeID, 0),
    charID: toInt(route.charID ?? route.ownerID, 0),
    commodityTypeID: toInt(route.commodityTypeID ?? route.typeID, 0),
    commodityQuantity: toInt(route.commodityQuantity ?? route.quantity, 0),
  });
}

function buildSerializedColony(colony = {}) {
  return buildKeyVal([
    ["ownerID", toInt(colony.ownerID, 0)],
    ["pins", buildList((Array.isArray(colony.pins) ? colony.pins : []).map(buildPinRow))],
    ["links", buildList((Array.isArray(colony.links) ? colony.links : []).map(buildLinkRow))],
    ["routes", buildList((Array.isArray(colony.routes) ? colony.routes : []).map(buildRouteRow))],
    ["level", toInt(colony.level ?? colony.commandCenterLevel, 0)],
    ["currentSimTime", colony.currentSimTime ? BigInt(colony.currentSimTime) : currentFileTime()],
  ]);
}

function buildPlanetInfo(planetMeta, colony = null) {
  const entries = [
    ["planetID", toInt(planetMeta.planetID, 0)],
    ["solarSystemID", toInt(planetMeta.solarSystemID, 0)],
    ["planetTypeID", toInt(planetMeta.typeID, 0)],
    ["typeID", toInt(planetMeta.typeID, 0)],
    ["radius", toInt(planetMeta.radius, 0)],
    ["celestialIndex", toInt(planetMeta.celestialIndex, 0)],
  ];

  if (colony) {
    const serializedColony = buildSerializedColony(colony);
    const serializedEntries = serializedColony.args.entries || [];
    entries.push(...serializedEntries);
  }

  return buildKeyVal(entries);
}

function buildResourceInfoForPlanet(planetMeta) {
  const resourceTypeIDs = getResourceTypeIDsForPlanetType(planetMeta.typeID);
  const resourceRecord = planetRuntimeStore.getOrCreatePlanetResources(
    planetMeta,
    resourceTypeIDs,
  );
  const qualities = resourceRecord.qualitiesByTypeID || {};
  return buildDict(
    (resourceRecord.resourceTypeIDs || resourceTypeIDs).map((resourceTypeID) => [
      toInt(resourceTypeID, 0),
      toInt(qualities[String(resourceTypeID)], 0),
    ]),
  );
}

function buildResourceDataResponse(info = {}) {
  const oldBand = toInt(info.oldBand, 0);
  return buildKeyVal([
    ["data", null],
    ["numBands", oldBand],
    ["proximity", Object.prototype.hasOwnProperty.call(info, "proximity") ? info.proximity : null],
  ]);
}

function buildCommandPinSummary(pin = {}, ownerID = 0) {
  const pinID = toInt(pin.pinID ?? pin.id, 0);
  return buildKeyVal([
    ["pinID", pinID],
    ["id", pinID],
    ["typeID", toInt(pin.typeID, 0)],
    ["ownerID", toInt(pin.ownerID ?? ownerID, 0)],
    ["latitude", Number(pin.latitude) || 0],
    ["longitude", Number(pin.longitude) || 0],
  ]);
}

function buildExtractorSummary(pin = {}, ownerID = 0) {
  const pinID = toInt(pin.pinID ?? pin.id, 0);
  return buildKeyVal([
    ["pinID", pinID],
    ["id", pinID],
    ["typeID", toInt(pin.typeID, 0)],
    ["ownerID", toInt(pin.ownerID ?? ownerID, 0)],
    ["latitude", Number(pin.latitude) || 0],
    ["longitude", Number(pin.longitude) || 0],
  ]);
}

function buildLaunchRow(launch = {}) {
  return buildKeyVal([
    ["launchID", toInt(launch.launchID ?? launch.itemID, 0)],
    ["itemID", toInt(launch.itemID ?? launch.launchID, 0)],
    ["ownerID", toInt(launch.ownerID, 0)],
    ["planetID", toInt(launch.planetID, 0)],
    ["solarSystemID", toInt(launch.solarSystemID, 0)],
    ["launchTime", launch.launchTime ? BigInt(launch.launchTime) : currentFileTime()],
    ["x", Number(launch.x) || 0],
    ["y", Number(launch.y) || 0],
    ["z", Number(launch.z) || 0],
  ]);
}

function extractPlanetIDFromValue(value) {
  const unwrapped = unwrapMarshalValue(value);
  if (Array.isArray(unwrapped)) {
    return extractPlanetIDFromValue(unwrapped[0]);
  }
  if (unwrapped && typeof unwrapped === "object") {
    return toInt(
      unwrapped.planetID ??
        unwrapped.itemID ??
        unwrapped.id ??
        unwrapped[0],
      0,
    );
  }
  return toInt(unwrapped, 0);
}

function extractPlanetIDFromArgs(args) {
  if (!Array.isArray(args) || args.length < 1) {
    return 0;
  }
  return extractPlanetIDFromValue(args[0]);
}

function extractBoundObjectIDFromBindResponse(response) {
  try {
    const boundObject = Array.isArray(response) ? response[0] : null;
    const substream = boundObject && boundObject.type === "substruct"
      ? boundObject.value
      : null;
    const objectID = substream && substream.type === "substream"
      ? substream.value
      : substream;
    return Array.isArray(objectID) && typeof objectID[0] === "string"
      ? objectID[0]
      : null;
  } catch (error) {
    return null;
  }
}

function ensurePlanetBindingMap(session) {
  if (!session || typeof session !== "object") {
    return null;
  }
  if (!session._planetMgrBoundPlanets || typeof session._planetMgrBoundPlanets !== "object") {
    session._planetMgrBoundPlanets = {};
  }
  return session._planetMgrBoundPlanets;
}

class PlanetMgrService extends BaseService {
  constructor() {
    super("planetMgr");
  }

  Handle_MachoResolveObject(args) {
    const planetID = extractPlanetIDFromArgs(args);
    log.debug(`[PlanetMgr] MachoResolveObject planetID=${planetID || "unknown"}`);
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    const planetID = extractPlanetIDFromArgs(args);
    log.debug(`[PlanetMgr] MachoBindObject planetID=${planetID || "unknown"}`);

    if (session && planetID > 0) {
      session._planetMgrBindingPlanetID = planetID;
      session._planetMgrLastPlanetID = planetID;
    }

    let response;
    try {
      response = buildBoundObjectResponse(this, args, session, kwargs);
    } finally {
      if (session && Object.prototype.hasOwnProperty.call(session, "_planetMgrBindingPlanetID")) {
        delete session._planetMgrBindingPlanetID;
      }
    }

    const boundObjectID = extractBoundObjectIDFromBindResponse(response);
    if (boundObjectID && planetID > 0) {
      const bindingMap = ensurePlanetBindingMap(session);
      if (bindingMap) {
        bindingMap[boundObjectID] = planetID;
      }
    }

    return response;
  }

  _resolvePlanetID(args, session, options = {}) {
    if (options.allowArgs === true) {
      const argPlanetID = extractPlanetIDFromArgs(args);
      if (argPlanetID > 0) {
        return argPlanetID;
      }
    }

    const bindingPlanetID = toInt(session && session._planetMgrBindingPlanetID, 0);
    if (bindingPlanetID > 0) {
      return bindingPlanetID;
    }

    const bindingMap = ensurePlanetBindingMap(session);
    const currentBoundObjectID = session && session.currentBoundObjectID;
    const boundPlanetID = bindingMap && currentBoundObjectID
      ? toInt(bindingMap[currentBoundObjectID], 0)
      : 0;
    if (boundPlanetID > 0) {
      return boundPlanetID;
    }

    return toInt(session && session._planetMgrLastPlanetID, 0);
  }

  Handle_GetPlanetsForChar(args, session) {
    log.debug("[PlanetMgr] GetPlanetsForChar");
    const characterRecord = getCharacterRecord(session && session.characterID);
    const runtimeColonies = planetRuntimeStore.listColoniesForCharacter(
      session && session.characterID,
    );
    return buildPlanetListForCharacter({
      ...(characterRecord || {}),
      runtimeColonies,
    });
  }

  Handle_GetPlanetInfo(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: true });
    log.debug(`[PlanetMgr] GetPlanetInfo planetID=${planetID || "unknown"}`);
    const planetMeta = getPlanetMeta(planetID);
    const colony = planetRuntimeStore.getColony(
      planetID,
      session && session.characterID,
    );
    return buildPlanetInfo(planetMeta, colony);
  }

  Handle_GetPlanetResourceInfo(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: true });
    log.debug(`[PlanetMgr] GetPlanetResourceInfo planetID=${planetID || "unknown"}`);
    return buildResourceInfoForPlanet(getPlanetMeta(planetID));
  }

  Handle_GetResourceData(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: false });
    const info = unwrapMarshalValue(Array.isArray(args) ? args[0] : {}) || {};
    const resourceTypeID = toInt(info.resourceTypeID, 0);
    log.debug(
      `[PlanetMgr] GetResourceData planetID=${planetID || "unknown"} resourceTypeID=${resourceTypeID || "unknown"}`,
    );
    return buildResourceDataResponse(info);
  }

  Handle_GetFullNetworkForOwner(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: true });
    const ownerID = toInt(
      Array.isArray(args) && args.length > 1 ? normalizeNumber(args[1], 0) : 0,
      0,
    );
    const colony = planetRuntimeStore.getColony(planetID, ownerID);
    if (!colony) {
      return [buildList([]), buildList([])];
    }

    const pins = (Array.isArray(colony.pins) ? colony.pins : []).map(buildPinRow);
    const links = (Array.isArray(colony.links) ? colony.links : [])
      .map((link) => buildList([toInt(link.endpoint1, 0), toInt(link.endpoint2, 0)]));
    return [buildList(pins), buildList(links)];
  }

  Handle_GetCommandPinsForPlanet(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: true });
    const entries = [];
    for (const colony of planetRuntimeStore.listColoniesForPlanet(planetID)) {
      const ownerID = toInt(colony.ownerID, 0);
      const commandPin = (Array.isArray(colony.pins) ? colony.pins : [])
        .find((pin) => getItemTypeGroupID(pin && pin.typeID) === GROUP_COMMAND_PINS);
      if (ownerID > 0 && commandPin) {
        entries.push([ownerID, buildCommandPinSummary(commandPin, ownerID)]);
      }
    }
    return buildDict(entries);
  }

  Handle_GetExtractorsForPlanet(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: true });
    const extractors = [];
    for (const colony of planetRuntimeStore.listColoniesForPlanet(planetID)) {
      const ownerID = toInt(colony.ownerID, 0);
      for (const pin of Array.isArray(colony.pins) ? colony.pins : []) {
        if (getItemTypeGroupID(pin && pin.typeID) === GROUP_EXTRACTOR_CONTROL_UNITS) {
          extractors.push(buildExtractorSummary(pin, ownerID));
        }
      }
    }
    return buildList(extractors);
  }

  Handle_GetMyLaunchesDetails(args, session) {
    log.debug("[PlanetMgr] GetMyLaunchesDetails");
    return buildList(
      planetRuntimeStore
        .listLaunchesForCharacter(session && session.characterID)
        .map(buildLaunchRow),
    );
  }

  Handle_DeleteLaunch(args, session) {
    const launchID = toInt(Array.isArray(args) && args.length > 0 ? args[0] : 0, 0);
    log.debug(`[PlanetMgr] DeleteLaunch launchID=${launchID || "unknown"}`);
    return planetRuntimeStore.deleteLaunch(launchID, session && session.characterID);
  }
}

PlanetMgrService._testing = {
  buildPlanetEntry,
  buildPlanetListForCharacter,
  buildPlanetInfo,
  buildResourceInfoForPlanet,
  extractPlanetIDFromValue,
  getCharacterColonies,
  getPlanetMeta,
  getResourceTypeIDsForPlanetType,
};

module.exports = PlanetMgrService;
