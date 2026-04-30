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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function keyValEntries(value) {
  assert.equal(value.type, "object");
  assert.equal(value.name, "util.KeyVal");
  return new Map(value.args.entries);
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
  assert.ok(state.resourcesByPlanetID["40000002"]);
  assert.deepEqual(
    state.resourcesByPlanetID["40000002"].resourceTypeIDs,
    [2073, 2268, 2287, 2288, 2305],
  );

  const secondResourceInfo = service.Handle_GetPlanetResourceInfo([], session);
  assert.deepEqual(secondResourceInfo, firstResourceInfo);
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
