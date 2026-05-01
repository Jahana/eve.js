const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  ITEM_FLAGS,
  consumeInventoryItemQuantity,
  findItemById,
  getActiveShipItem,
} = require(path.join(__dirname, "../inventory/itemStore"));
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
const planetStaticData = require("./planetStaticData");
const planetRuntimeStore = require("./planetRuntimeStore");

let planetMetaCache = null;

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
  const typeInfo = planetStaticData.getPITypeInfo(typeID);
  return typeInfo ? typeInfo.groupID : 0;
}

function getResourceTypeIDsForPlanetType(planetTypeID) {
  return planetStaticData.getPlanetResourceTypeIDs(planetTypeID);
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

function toFiletimeBigInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  try {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }
    if (typeof value === "string") {
      return BigInt(value);
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function buildPinRow(pin = {}) {
  const pinID = toInt(pin.pinID ?? pin.id, 0);
  const entityType = planetStaticData.getPinEntityType(pin.typeID);
  const row = {
    ...pin,
    id: toInt(pin.id ?? pinID, pinID),
    pinID,
    ownerID: toInt(pin.ownerID ?? pin.charID, 0),
    typeID: toInt(pin.typeID, 0),
    latitude: Number(pin.latitude) || 0,
    longitude: Number(pin.longitude) || 0,
    lastRunTime: toFiletimeBigInt(pin.lastRunTime, currentFileTime()),
  };

  if (entityType === "command" || entityType === "spaceport") {
    row.lastLaunchTime = toFiletimeBigInt(pin.lastLaunchTime, 0n);
  }

  if (entityType === "ecu") {
    row.expiryTime = toFiletimeBigInt(pin.expiryTime, null);
    row.installTime = toFiletimeBigInt(pin.installTime, null);
  }

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

function buildResourceDataResponse(planetMeta, info = {}) {
  const resourceTypeIDs = getResourceTypeIDsForPlanetType(planetMeta.typeID);
  const resourceTypeID = toInt(info.resourceTypeID, 0);
  const resourceData = planetRuntimeStore.getResourceDataForClient(
    planetMeta,
    resourceTypeID,
    resourceTypeIDs,
    info,
  );
  return buildKeyVal([
    ["data", resourceData.data],
    ["numBands", resourceData.numBands],
    ["proximity", resourceData.proximity],
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

function sendPlanetNotification(session, methodName, args = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  try {
    session.sendNotification(methodName, "clientID", args);
  } catch (error) {
    log.warn(`[PlanetMgr] Failed to send ${methodName}: ${error.message}`);
  }
}

function getSessionCharacterID(session) {
  return toInt(
    session && (session.characterID ?? session.charid ?? session.charID ?? session.userid),
    0,
  );
}

function getSessionShipID(session, characterID = 0) {
  const sessionShipID = toInt(
    session && (
      session.shipID ??
      session.shipid ??
      session.shipId ??
      (session._space && session._space.shipID)
    ),
    0,
  );
  if (sessionShipID > 0) {
    return sessionShipID;
  }

  const activeShip = getActiveShipItem(characterID);
  return toInt(activeShip && activeShip.itemID, 0);
}

function isCommandCenterSourceItem(item, pin, characterID, shipID) {
  if (!item || !pin) {
    return false;
  }

  const allowedSourceFlags = new Set([
    ITEM_FLAGS.CARGO_HOLD,
    ITEM_FLAGS.SPECIALIZED_COMMAND_CENTER_HOLD,
    ITEM_FLAGS.COLONY_RESOURCES_HOLD,
  ]);

  return (
    toInt(item.ownerID, 0) === characterID &&
    toInt(item.typeID, 0) === toInt(pin.typeID, 0) &&
    toInt(item.locationID, 0) === shipID &&
    allowedSourceFlags.has(toInt(item.flagID, 0)) &&
    planetStaticData.getPinEntityType(pin.typeID) === "command"
  );
}

function syncInventoryChanges(session, changes = []) {
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || !change.item) {
      continue;
    }
    syncInventoryItemForSession(
      session,
      change.item,
      change.previousData || {},
      { emitCfgLocation: true },
    );
  }
}

function consumePlacedCommandCenterItems(colony, session) {
  const characterID = getSessionCharacterID(session);
  const shipID = getSessionShipID(session, characterID);
  if (characterID <= 0 || shipID <= 0 || !colony) {
    return;
  }

  const commandPins = (Array.isArray(colony.pins) ? colony.pins : [])
    .filter((pin) => planetStaticData.getPinEntityType(pin && pin.typeID) === "command");
  for (const pin of commandPins) {
    const pinID = toInt(pin.pinID ?? pin.id, 0);
    if (pinID <= 0) {
      continue;
    }

    const sourceItem = findItemById(pinID);
    if (!isCommandCenterSourceItem(sourceItem, pin, characterID, shipID)) {
      continue;
    }

    const consumeResult = consumeInventoryItemQuantity(pinID, 1, {
      removeContents: false,
    });
    if (!consumeResult.success) {
      log.warn(
        `[PlanetMgr] Failed to consume command center itemID=${pinID}: ${consumeResult.errorMsg || "UNKNOWN"}`,
      );
      continue;
    }

    log.debug(`[PlanetMgr] Consumed command center itemID=${pinID} for PI deployment`);
    syncInventoryChanges(session, consumeResult.data && consumeResult.data.changes);
  }
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
    const response = buildResourceDataResponse(getPlanetMeta(planetID), info);
    const entries = new Map(response.args.entries || []);
    const data = entries.get("data");
    const dataBytes = data && data.type === "bytes" && Buffer.isBuffer(data.value)
      ? data.value.length
      : 0;
    log.debug(
      `[PlanetMgr] GetResourceData planetID=${planetID || "unknown"} resourceTypeID=${resourceTypeID || "unknown"} oldBand=${toInt(info.oldBand, 0)} newBand=${toInt(info.newBand, 0)} dataBytes=${dataBytes}`,
    );
    return response;
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
        .find((pin) => (
          getItemTypeGroupID(pin && pin.typeID) === planetStaticData.GROUP.COMMAND_PINS
        ));
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
        if (
          getItemTypeGroupID(pin && pin.typeID) ===
          planetStaticData.GROUP.EXTRACTION_CONTROL_UNIT_PINS
        ) {
          extractors.push(buildExtractorSummary(pin, ownerID));
        }
      }
    }
    return buildList(extractors);
  }

  Handle_UserUpdateNetwork(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: false });
    const planetMeta = getPlanetMeta(planetID);
    const serializedChanges = unwrapMarshalValue(Array.isArray(args) ? args[0] : []);
    const commandCount = Array.isArray(serializedChanges) ? serializedChanges.length : 0;
    log.debug(
      `[PlanetMgr] UserUpdateNetwork planetID=${planetID || "unknown"} commands=${commandCount}`,
    );

    const resourceTypeIDs = getResourceTypeIDsForPlanetType(planetMeta.typeID);
    planetRuntimeStore.getOrCreatePlanetResources(planetMeta, resourceTypeIDs);
    const colony = planetRuntimeStore.applyUserUpdateNetwork({
      planetID,
      ownerID: getSessionCharacterID(session),
      solarSystemID: planetMeta.solarSystemID,
      planetTypeID: planetMeta.typeID,
      serializedChanges,
    });

    consumePlacedCommandCenterItems(colony, session);
    sendPlanetNotification(session, "OnPlanetChangesSubmitted", [planetID]);
    return buildSerializedColony(colony);
  }

  Handle_UserAbandonPlanet(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: false });
    log.debug(`[PlanetMgr] UserAbandonPlanet planetID=${planetID || "unknown"}`);
    const result = planetRuntimeStore.abandonColony(
      planetID,
      session && session.characterID,
    );
    sendPlanetNotification(session, "OnMajorPlanetStateUpdate", [planetID, true]);
    return result;
  }

  Handle_GetProgramResultInfo(args, session) {
    const planetID = this._resolvePlanetID(args, session, { allowArgs: false });
    const planetMeta = getPlanetMeta(planetID);
    const resourceTypeID = toInt(Array.isArray(args) && args.length > 1 ? args[1] : 0, 0);
    const heads = unwrapMarshalValue(Array.isArray(args) && args.length > 2 ? args[2] : []);
    const headRadius = Number(
      unwrapMarshalValue(Array.isArray(args) && args.length > 3 ? args[3] : 0.01),
    ) || 0.01;

    planetRuntimeStore.getOrCreatePlanetResources(
      planetMeta,
      getResourceTypeIDsForPlanetType(planetMeta.typeID),
    );
    const result = planetRuntimeStore.estimateProgramResult({
      planetID,
      resourceTypeID,
      heads,
      headRadius,
    });
    log.debug(
      `[PlanetMgr] GetProgramResultInfo planetID=${planetID || "unknown"} resourceTypeID=${resourceTypeID || "unknown"} qty=${result.qtyToDistribute}`,
    );

    return [result.qtyToDistribute, result.cycleTime, result.numCycles];
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
