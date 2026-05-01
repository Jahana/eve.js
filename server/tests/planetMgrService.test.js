const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const config = require(path.join(repoRoot, "server/src/config"));
const database = require(path.join(repoRoot, "server/src/newDatabase"));
const PlanetMgrService = require(path.join(
  repoRoot,
  "server/src/services/planet/planetMgrService",
));
const planetRuntimeStore = require(path.join(
  repoRoot,
  "server/src/services/planet/planetRuntimeStore",
));
const itemStore = require(path.join(
  repoRoot,
  "server/src/services/inventory/itemStore",
));

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function keyValEntries(value) {
  assert.equal(value.type, "object");
  assert.equal(value.name, "util.KeyVal");
  return new Map(value.args.entries);
}

function listItems(value) {
  assert.equal(value.type, "list");
  return value.items;
}

function keyValObject(value) {
  return Object.fromEntries(keyValEntries(value));
}

function resetPlanetRuntimeState() {
  database.write(planetRuntimeStore.TABLE_NAME, "/", {
    schemaVersion: planetRuntimeStore.SCHEMA_VERSION,
    resourcesByPlanetID: {},
    coloniesByKey: {},
    launchesByID: {},
    nextIDs: cloneJson(planetRuntimeStore.DEFAULT_NEXT_IDS),
  });
}

function withRestoredPlanetRuntimeState(t) {
  const original = cloneJson(
    database.read(planetRuntimeStore.TABLE_NAME, "/").data || {},
  );
  t.after(() => {
    database.write(planetRuntimeStore.TABLE_NAME, "/", original, { force: true });
  });
  resetPlanetRuntimeState();
}

function withRestoredItemsState(t) {
  const original = cloneJson(
    database.read(itemStore.ITEMS_TABLE, "/").data || {},
  );
  t.after(() => {
    database.write(itemStore.ITEMS_TABLE, "/", original, { force: true });
    itemStore.resetInventoryStoreForTests();
  });
  itemStore.resetInventoryStoreForTests();
}

test("planetMgr returns an empty list shape when the character has no colonies", () => {
  const result =
    PlanetMgrService._testing.buildPlanetListForCharacter({});

  assert.deepEqual(result, {
    type: "list",
    items: [],
  });
});

test("planetMgr builds planet rows from colony-style character data", () => {
  const result = PlanetMgrService._testing.buildPlanetListForCharacter({
    colonies: [
      {
        planetID: 40000002,
        commandCenterLevel: 4,
        pinCount: 12,
      },
    ],
  });

  assert.equal(result.type, "list");
  assert.equal(result.items.length, 1);

  const row = result.items[0];
  assert.equal(row.name, "util.KeyVal");
  const entries = new Map(row.args.entries);

  assert.equal(entries.get("planetID"), 40000002);
  assert.equal(entries.get("solarSystemID"), 30000001);
  assert.equal(entries.get("typeID"), 11);
  assert.equal(entries.get("numberOfPins"), 12);
  assert.equal(entries.get("celestialIndex"), 1);
  assert.equal(entries.get("commandCenterLevel"), 4);
});

test("planetMgr resolves and binds planet monikers with nested GetPlanetInfo", () => {
  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };

  assert.equal(service.Handle_MachoResolveObject([40000002], session), config.proxyNodeId);

  const bindResult = service.Handle_MachoBindObject(
    [40000002, ["GetPlanetInfo", [], null]],
    session,
  );

  assert.equal(Array.isArray(bindResult), true);
  assert.equal(bindResult[0].type, "substruct");
  assert.equal(bindResult[0].value.type, "substream");
  assert.equal(typeof bindResult[0].value.value[0], "string");
  assert.equal(bindResult[0].value.value[0].startsWith("N="), true);

  const entries = keyValEntries(bindResult[1]);
  assert.equal(entries.get("planetID"), 40000002);
  assert.equal(entries.get("solarSystemID"), 30000001);
  assert.equal(entries.get("planetTypeID"), 11);
  assert.equal(entries.get("radius"), 5060000);
  assert.equal(entries.get("celestialIndex"), 1);
});

test("planetMgr bound calls use the bound planet and persist resource quality data", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const firstResourceInfo = service.Handle_GetPlanetResourceInfo([], session);
  assert.equal(firstResourceInfo.type, "dict");
  const firstEntries = new Map(firstResourceInfo.entries);

  assert.deepEqual(
    [...firstEntries.keys()].sort((left, right) => left - right),
    [2073, 2268, 2287, 2288, 2305],
  );
  for (const quality of firstEntries.values()) {
    assert.equal(Number.isInteger(quality), true);
    assert.equal(quality > 0, true);
  }

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const resourceRecord = state.resourcesByPlanetID["40000002"];
  assert.ok(resourceRecord);
  assert.deepEqual(
    resourceRecord.resourceTypeIDs,
    [2073, 2268, 2287, 2288, 2305],
  );
  assert.equal(resourceRecord.version, 2);
  assert.equal(Object.keys(resourceRecord.layersByTypeID).length, 5);
  assert.equal(resourceRecord.layersByTypeID["2268"].version, 1);
  assert.equal(resourceRecord.layersByTypeID["2268"].hotspots.length >= 6, true);

  const secondResourceInfo = service.Handle_GetPlanetResourceInfo([], session);
  assert.deepEqual(secondResourceInfo, firstResourceInfo);
});

test("planet resource layers are persistent and drive ECU estimates", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  service.Handle_GetPlanetResourceInfo([], session);
  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const layer = state.resourcesByPlanetID["40000002"].layersByTypeID["2268"];
  const hotspot = layer.hotspots[0];

  const firstValue = planetRuntimeStore.evaluateResourceValueAt(
    40000002,
    2268,
    hotspot.latitude,
    hotspot.longitude,
  );
  const secondValue = planetRuntimeStore.evaluateResourceValueAt(
    40000002,
    2268,
    hotspot.latitude,
    hotspot.longitude,
  );
  assert.equal(firstValue, secondValue);
  assert.equal(firstValue > 0, true);
  assert.equal(firstValue <= planetRuntimeStore.PLANET_RESOURCE_MAX_VALUE, true);

  const programResult = service.Handle_GetProgramResultInfo([
    [1, 1],
    2268,
    [[0, hotspot.latitude, hotspot.longitude]],
    0.02,
  ], session);
  assert.equal(programResult[0] > 0, true);

  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [1, [[1, 1], 2848, hotspot.latitude, hotspot.longitude]],
      [10, [[1, 1], 0, hotspot.latitude, hotspot.longitude]],
      [13, [[1, 1], 2268, 0.02]],
    ],
  ], session);

  const updatedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const updatedLayer = updatedState.resourcesByPlanetID["40000002"].layersByTypeID["2268"];
  assert.equal(updatedLayer.depletionEvents.length, 1);

  const depletedProgramResult = service.Handle_GetProgramResultInfo([
    [1, 1],
    2268,
    [[0, hotspot.latitude, hotspot.longitude]],
    0.02,
  ], session);
  assert.equal(depletedProgramResult[0] < programResult[0], true);
});

test("planetMgr returns deterministic resource heatmap bytes for bound planets", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const requestInfo = {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["resourceTypeID", 2268],
        ["oldBand", 0],
        ["newBand", 3],
        ["proximity", 4],
      ],
    },
  };
  const firstResourceData = service.Handle_GetResourceData([requestInfo], session);
  const firstEntries = keyValEntries(firstResourceData);
  const firstData = firstEntries.get("data");
  assert.equal(firstEntries.get("numBands"), 3);
  assert.equal(firstEntries.get("proximity"), 4);
  assert.equal(firstData.type, "bytes");
  assert.equal(Buffer.isBuffer(firstData.value), true);
  assert.equal(firstData.value.length, 3 * 3 * 4);
  assert.equal(Number.isFinite(firstData.value.readFloatLE(0)), true);

  const secondResourceData = service.Handle_GetResourceData([requestInfo], session);
  const secondData = keyValEntries(secondResourceData).get("data");
  assert.equal(secondData.value.equals(firstData.value), true);

  const higherBandRequestInfo = cloneJson(requestInfo);
  higherBandRequestInfo.args.entries = higherBandRequestInfo.args.entries
    .map(([key, value]) => [key, key === "newBand" ? 5 : value]);
  const higherBandData = keyValEntries(
    service.Handle_GetResourceData([higherBandRequestInfo], session),
  ).get("data");
  assert.equal(higherBandData.value.length, 5 * 5 * 4);
  assert.equal(
    higherBandData.value.subarray(0, firstData.value.length).equals(firstData.value),
    true,
  );
});

test("planetMgr Phase 0 read-only PI calls return stable empty shapes", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };

  assert.deepEqual(service.Handle_GetFullNetworkForOwner([40000002, 140000239], session), [
    { type: "list", items: [] },
    { type: "list", items: [] },
  ]);

  assert.deepEqual(service.Handle_GetCommandPinsForPlanet([40000002], session), {
    type: "dict",
    entries: [],
  });
  assert.deepEqual(service.Handle_GetExtractorsForPlanet([40000002], session), {
    type: "list",
    items: [],
  });
  assert.deepEqual(service.Handle_GetMyLaunchesDetails([], session), {
    type: "list",
    items: [],
  });
  assert.equal(service.Handle_DeleteLaunch([910000000000], session), true);

  const resourceData = service.Handle_GetResourceData([
    {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["resourceTypeID", 2268],
          ["oldBand", 0],
          ["newBand", 3],
          ["proximity", 4],
        ],
      },
    },
  ], session);
  const entries = keyValEntries(resourceData);
  assert.equal(entries.get("data"), null);
  assert.equal(entries.get("numBands"), 0);
  assert.equal(entries.get("proximity"), 4);
});

test("planetMgr persists submitted PI colony edits and remaps temporary IDs", (t) => {
  withRestoredPlanetRuntimeState(t);
  withRestoredItemsState(t);

  const service = new PlanetMgrService();
  const shipID = 990000001;
  const commandCenterGrant = itemStore.grantItemToCharacterLocation(
    140000238,
    shipID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
    2524,
    1,
    { singleton: 0 },
  );
  assert.equal(commandCenterGrant.success, true);
  const commandCenterID = commandCenterGrant.data.items[0].itemID;
  const notifications = [];
  const session = {
    characterID: 140000238,
    shipID,
    sendNotification: (...args) => notifications.push(args),
  };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const tempEcuID = [1, 1];
  const tempProcessorID = [1, 2];
  const tempRouteID = [2, 1];
  const colonyResult = service.Handle_UserUpdateNetwork([
    [
      [1, [commandCenterID, 2524, 0.1, 0.2]],
      [9, [commandCenterID, 2]],
      [1, [tempEcuID, 2848, 0.12, 0.22]],
      [10, [tempEcuID, 0, 0.13, 0.23]],
      [12, [tempEcuID, 0, 0.14, 0.24]],
      [13, [tempEcuID, 2268, 0.02]],
      [3, [commandCenterID, tempEcuID, 0]],
      [1, [tempProcessorID, 2473, 0.15, 0.25]],
      [8, [tempProcessorID, 121]],
      [3, [tempEcuID, tempProcessorID, 0]],
      [6, [tempRouteID, [tempEcuID, tempProcessorID], 2268, 100]],
    ],
  ], session);

  const colony = keyValObject(colonyResult);
  assert.equal(colony.ownerID, 140000238);
  assert.equal(colony.level, 2);
  assert.equal(typeof colony.currentSimTime, "bigint");

  const pins = listItems(colony.pins).map(keyValObject);
  assert.equal(pins.length, 3);
  const commandPin = pins.find((pin) => pin.typeID === 2524);
  const ecuPin = pins.find((pin) => pin.typeID === 2848);
  const processorPin = pins.find((pin) => pin.typeID === 2473);

  assert.equal(commandPin.id, commandCenterID);
  assert.equal(commandPin.lastLaunchTime, 0n);
  assert.equal(ecuPin.id >= 900000000000, true);
  assert.equal(ecuPin.programType, 2268);
  assert.equal(ecuPin.cycleTime > 0, true);
  assert.equal(ecuPin.qtyPerCycle > 0, true);
  assert.equal(typeof ecuPin.expiryTime, "bigint");
  assert.equal(typeof ecuPin.installTime, "bigint");
  assert.deepEqual(ecuPin.heads.items[0].items, [0, 0.14, 0.24]);
  assert.equal(processorPin.schematicID, 121);

  const links = listItems(colony.links).map(keyValObject);
  assert.equal(links.length, 2);
  assert.deepEqual(
    links.map((link) => [link.endpoint1, link.endpoint2, link.typeID, link.level]),
    [
      [commandCenterID, ecuPin.id, 2280, 0],
      [ecuPin.id, processorPin.id, 2280, 0],
    ],
  );

  const routes = listItems(colony.routes).map(keyValObject);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].routeID, 1);
  assert.deepEqual(routes[0].path.items, [ecuPin.id, processorPin.id]);
  assert.equal(routes[0].commodityTypeID, 2268);
  assert.equal(routes[0].commodityQuantity, 100);

  const storedState = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  const storedColony = storedState.coloniesByKey["40000002:140000238"];
  assert.equal(storedColony.pins.length, 3);
  assert.equal(storedColony.level, 2);

  const characterPlanets = service.Handle_GetPlanetsForChar([], session);
  const planetEntry = keyValObject(listItems(characterPlanets)[0]);
  assert.equal(planetEntry.planetID, 40000002);
  assert.equal(planetEntry.numberOfPins, 3);
  assert.equal(planetEntry.commandCenterLevel, 2);

  assert.equal(itemStore.findItemById(commandCenterID), null);
  assert.equal(
    notifications.some((notification) => (
      notification[0] === "OnItemChange" &&
      Array.isArray(notification[2]) &&
      notification[2][0] &&
      notification[2][0].fields &&
      notification[2][0].fields.itemID === commandCenterID
    )),
    true,
  );
  assert.deepEqual(notifications.find((notification) => notification[0] === "OnPlanetChangesSubmitted"), [
    "OnPlanetChangesSubmitted",
    "clientID",
    [40000002],
  ]);
});

test("planetMgr applies PI removal and update commands across an existing colony", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const session = { characterID: 140000238 };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const initial = keyValObject(service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [1, [[1, 1], 2848, 0.12, 0.22]],
      [10, [[1, 1], 0, 0.13, 0.23]],
      [3, [9001, [1, 1], 0]],
      [1, [[1, 2], 2473, 0.15, 0.25]],
      [3, [[1, 1], [1, 2], 0]],
      [6, [[2, 1], [[1, 1], [1, 2]], 2268, 100]],
    ],
  ], session));
  const initialPins = listItems(initial.pins).map(keyValObject);
  const ecuID = initialPins.find((pin) => pin.typeID === 2848).id;
  const processorID = initialPins.find((pin) => pin.typeID === 2473).id;

  const updated = keyValObject(service.Handle_UserUpdateNetwork([
    [
      [5, [9001, ecuID, 1]],
      [7, [1]],
      [11, [ecuID, 0]],
      [10, [ecuID, 1, 0.18, 0.28]],
      [4, [9001, ecuID]],
      [2, [processorID]],
    ],
  ], session));

  const pins = listItems(updated.pins).map(keyValObject);
  const ecuPin = pins.find((pin) => pin.typeID === 2848);
  assert.equal(pins.some((pin) => pin.id === processorID), false);
  assert.deepEqual(ecuPin.heads.items[0].items, [1, 0.18, 0.28]);
  assert.deepEqual(
    listItems(updated.links).map(keyValObject).map((link) => [link.endpoint1, link.endpoint2, link.level]),
    [],
  );
  assert.deepEqual(listItems(updated.routes).map(keyValObject), []);
});

test("planetMgr estimates ECU program results and abandons persistent colonies", (t) => {
  withRestoredPlanetRuntimeState(t);

  const service = new PlanetMgrService();
  const notifications = [];
  const session = {
    characterID: 140000238,
    sendNotification: (...args) => notifications.push(args),
  };
  const bindResult = service.Handle_MachoBindObject([40000002, null], session);
  session.currentBoundObjectID = bindResult[0].value.value[0];

  const programResult = service.Handle_GetProgramResultInfo([
    [1, 1],
    2268,
    [[0, 0.1, 0.2], [1, 0.12, 0.22]],
    0.03,
  ], session);
  assert.equal(programResult.length, 3);
  assert.equal(programResult[0] > 0, true);
  assert.equal(programResult[1] > 0, true);
  assert.equal(programResult[2] > 0, true);

  service.Handle_UserUpdateNetwork([
    [
      [1, [9001, 2524, 0.1, 0.2]],
      [9, [9001, 1]],
    ],
  ], session);
  assert.equal(service.Handle_UserAbandonPlanet([], session), true);

  const state = database.read(planetRuntimeStore.TABLE_NAME, "/").data;
  assert.equal(state.coloniesByKey["40000002:140000238"], undefined);
  assert.deepEqual(service.Handle_GetPlanetsForChar([], session), {
    type: "list",
    items: [],
  });
  assert.deepEqual(notifications.at(-1), [
    "OnMajorPlanetStateUpdate",
    "clientID",
    [40000002, true],
  ]);
});
