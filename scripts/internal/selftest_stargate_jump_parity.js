const assert = require("assert");
const path = require("path");

const runtime = require(path.join(__dirname, "../../server/src/space/runtime"));
const transitions = require(path.join(__dirname, "../../server/src/space/transitions"));
const worldData = require(path.join(__dirname, "../../server/src/space/worldData"));

function createFakeSession(clientID, characterID, systemID) {
  const notifications = [];
  return {
    clientID,
    characterID,
    characterName: `char-${characterID}`,
    shipName: `ship-${characterID}`,
    corporationID: 1,
    allianceID: 0,
    warFactionID: 0,
    solarsystemid: systemID,
    solarsystemid2: systemID,
    socket: { destroyed: false },
    notifications,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
}

function extractDestinyUpdates(notifications) {
  return notifications.flatMap((notification) => {
    const payload = (((notification || {}).payload || [])[0] || {});
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.map((entry) => ({
      stamp: entry[0],
      name: entry[1][0],
      args: entry[1][1],
    }));
  });
}

function createShipItem(itemID, typeID, ownerID, position, direction = { x: 1, y: 0, z: 0 }) {
  return {
    itemID,
    typeID,
    ownerID,
    groupID: 25,
    categoryID: 6,
    radius: 50,
    spaceState: {
      position,
      velocity: { x: 0, y: 0, z: 0 },
      direction,
      mode: "STOP",
      speedFraction: 0,
    },
  };
}

function addVector(position, offset) {
  return {
    x: position.x + offset.x,
    y: position.y + offset.y,
    z: position.z + offset.z,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function main() {
  runtime._testing.clearScenes();

  const sourceGate = worldData.getStargateByID(50001248);
  assert(sourceGate, "Expected Jita source gate to exist");
  const destinationGate = worldData.getStargateByID(sourceGate.destinationID);
  assert(destinationGate, "Expected destination gate to exist");

  const sourceDirection = transitions._testing.getResolvedStargateForwardDirection(sourceGate);
  const sourcePilotPosition = addVector(
    sourceGate.position,
    scaleVector(sourceDirection, Math.max((sourceGate.radius || 15000) * 0.1, 1000)),
  );
  const destinationSpawnState = transitions._testing.buildGateSpawnState(destinationGate);
  const destinationObserverPosition = addVector(
    destinationGate.position,
    scaleVector(destinationSpawnState.direction, 1000),
  );

  const pilotSession = createFakeSession(980001, 990001, sourceGate.solarSystemID);
  const sourceObserverSession = createFakeSession(980002, 990002, sourceGate.solarSystemID);
  const destinationObserverSession = createFakeSession(
    980003,
    990003,
    destinationGate.solarSystemID,
  );

  const pilotShip = createShipItem(
    970001,
    606,
    pilotSession.characterID,
    sourcePilotPosition,
    sourceDirection,
  );
  const sourceObserverShip = createShipItem(
    970002,
    606,
    sourceObserverSession.characterID,
    addVector(sourcePilotPosition, { x: 1000, y: 0, z: 0 }),
    { x: -1, y: 0, z: 0 },
  );
  const destinationObserverShip = createShipItem(
    970003,
    606,
    destinationObserverSession.characterID,
    destinationObserverPosition,
    scaleVector(destinationSpawnState.direction, -1),
  );

  runtime.attachSession(pilotSession, pilotShip, {
    systemID: sourceGate.solarSystemID,
    broadcast: false,
    spawnStopped: true,
  });
  runtime.attachSession(sourceObserverSession, sourceObserverShip, {
    systemID: sourceGate.solarSystemID,
    broadcast: false,
    spawnStopped: true,
  });
  runtime.attachSession(destinationObserverSession, destinationObserverShip, {
    systemID: destinationGate.solarSystemID,
    broadcast: false,
    spawnStopped: true,
  });

  try {
    pilotSession._space.initialStateSent = true;
    sourceObserverSession._space.initialStateSent = true;
    destinationObserverSession._space.initialStateSent = true;

    const sourceScene = runtime.getSceneForSession(pilotSession);
    const destinationScene = runtime.getSceneForSession(destinationObserverSession);
    assert(sourceScene, "Expected source scene");
    assert(destinationScene, "Expected destination scene");

    sourceScene.syncDynamicVisibilityForAllSessions();
    destinationScene.syncDynamicVisibilityForAllSessions();
    pilotSession.notifications.length = 0;
    sourceObserverSession.notifications.length = 0;
    destinationObserverSession.notifications.length = 0;

    const startResult = runtime.startStargateJump(pilotSession, sourceGate.itemID);
    assert.strictEqual(startResult.success, true, "Expected stargate jump start to succeed");
    assert.strictEqual(startResult.data.deliveredCount, 2, "JumpOut should reach pilot and source observer");

    const pilotJumpUpdates = extractDestinyUpdates(pilotSession.notifications);
    const sourceObserverJumpUpdates = extractDestinyUpdates(sourceObserverSession.notifications);
    const destinationObserverJumpUpdates = extractDestinyUpdates(destinationObserverSession.notifications);
    const pilotJumpOut = pilotJumpUpdates.find((update) => update.name === "OnSpecialFX");
    const sourceObserverJumpOut = sourceObserverJumpUpdates.find((update) => update.name === "OnSpecialFX");

    assert(pilotJumpOut, "Pilot should receive JumpOut FX");
    assert(sourceObserverJumpOut, "Source observer should receive JumpOut FX");
    assert.strictEqual(destinationObserverJumpUpdates.length, 0, "Destination observer should not receive source JumpOut FX");
    assert.strictEqual(pilotJumpOut.args[0], pilotShip.itemID, "JumpOut should target the pilot ship");
    assert.strictEqual(pilotJumpOut.args[3], sourceGate.itemID, "JumpOut targetID should be the source gate");
    assert.strictEqual(pilotJumpOut.args[5], "effects.JumpOut", "JumpOut guid should match CCP client expectation");
    assert.strictEqual(pilotJumpOut.args[7], 1, "JumpOut should use start=1");
    assert.strictEqual(pilotJumpOut.args[8], 0, "JumpOut should use active=0 for a one-shot event");
    assert.deepStrictEqual(
      pilotJumpOut.args[13],
      { type: "list", items: [sourceGate.destinationSolarSystemID] },
      "JumpOut graphicInfo should provide the destination system for the client subway transition",
    );

    pilotSession.notifications.length = 0;
    sourceObserverSession.notifications.length = 0;
    runtime.detachSession(pilotSession, { broadcast: true });

    const sourceObserverDetachUpdates = extractDestinyUpdates(sourceObserverSession.notifications);
    const removeBallsUpdate = sourceObserverDetachUpdates.find((update) => update.name === "RemoveBalls");
    assert(removeBallsUpdate, "Source observer should lose the jumping ship on detach");
    assert(removeBallsUpdate.args[0].items.includes(pilotShip.itemID), "RemoveBalls should include the pilot ship");

    pilotSession.notifications.length = 0;
    destinationObserverSession.notifications.length = 0;
    const destinationPilotShip = createShipItem(
      pilotShip.itemID,
      pilotShip.typeID,
      pilotSession.characterID,
      destinationSpawnState.position,
      destinationSpawnState.direction,
    );
    pilotSession.solarsystemid = destinationGate.solarSystemID;
    pilotSession.solarsystemid2 = destinationGate.solarSystemID;
    runtime.attachSession(pilotSession, destinationPilotShip, {
      systemID: destinationGate.solarSystemID,
      broadcast: true,
      spawnStopped: true,
    });

    const destinationObserverArrivalUpdates = extractDestinyUpdates(
      destinationObserverSession.notifications,
    );
    const addBallsUpdate = destinationObserverArrivalUpdates.find((update) => update.name === "AddBalls2");
    assert(addBallsUpdate, "Destination observer should receive AddBalls2 for normal arrival visibility");

    console.log(JSON.stringify({
      ok: true,
      jumpOutRecipients: startResult.data.deliveredCount,
      sourceObserverUpdates: sourceObserverJumpUpdates.map((update) => update.name),
      sourceObserverDetachUpdates: sourceObserverDetachUpdates.map((update) => update.name),
      destinationObserverArrivalUpdates: destinationObserverArrivalUpdates.map((update) => update.name),
      destinationSpawnPosition: destinationSpawnState.position,
      destinationSpawnDirection: destinationSpawnState.direction,
    }, null, 2));
  } finally {
    runtime.detachSession(pilotSession, { broadcast: false });
    runtime.detachSession(sourceObserverSession, { broadcast: false });
    runtime.detachSession(destinationObserverSession, { broadcast: false });
    runtime._testing.clearScenes();
  }
}

main();
