const assert = require("assert");
const path = require("path");

const { executeChatCommand } = require(path.join(
  __dirname,
  "../../server/src/services/chat/chatCommands",
));
const worldData = require(path.join(
  __dirname,
  "../../server/src/space/worldData",
));
const spaceRuntime = require(path.join(
  __dirname,
  "../../server/src/space/runtime",
));

const TEST_SYSTEM_ID = 30000142;
const WATCHED_GATE_ID = 50001250;

function getDictValue(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) {
    return undefined;
  }

  const match = dict.entries.find(([entryKey]) => entryKey === key);
  return match ? match[1] : undefined;
}

function getDestinyUpdates(notifications) {
  return (notifications || []).flatMap((entry) => {
    if (entry.notifyType !== "DoDestinyUpdate") {
      return [];
    }
    const updateList = entry.payloadTuple && entry.payloadTuple[0];
    if (!updateList || updateList.type !== "list" || !Array.isArray(updateList.items)) {
      return [];
    }
    return updateList.items.map((item) => ({
      stamp: item[0],
      payload: item[1],
    }));
  });
}

function main() {
  const stargates = worldData.getStargatesForSystem(TEST_SYSTEM_ID);
  const destinationSystemIDs = [...new Set(
    stargates
      .map((stargate) => Number(stargate.destinationSolarSystemID || 0))
      .filter((systemID) => Number.isInteger(systemID) && systemID > 0 && systemID !== TEST_SYSTEM_ID),
  )];
  assert(destinationSystemIDs.length > 0, "Test system should have destination gates");

  spaceRuntime._testing.clearScenes();

  const session = {
    characterID: 140000001,
    solarsystemid2: TEST_SYSTEM_ID,
  };

  try {
    const result = executeChatCommand(
      session,
      "/loadsys",
      null,
      { emitChatFeedback: false },
    );

    assert.strictEqual(result.handled, true, "Command should be handled");
    assert(
      result.message.includes("/loadsys"),
      "Feedback should mention the command",
    );
    assert(
      result.message.includes("loaded"),
      "Feedback should mention loaded systems",
    );
    for (const systemID of destinationSystemIDs) {
      assert(
        spaceRuntime.isSolarSystemSceneLoaded(systemID),
        `Destination system ${systemID} should be loaded`,
      );
    }

    spaceRuntime._testing.clearScenes();
    spaceRuntime._testing.resetStargateActivationOverrides();

    const {
      CLOSED,
      ACTIVATING,
      OPEN,
    } = spaceRuntime._testing.STARGATE_ACTIVATION_STATE;
    const { STARGATE_ACTIVATION_TRANSITION_MS } = spaceRuntime._testing;
    const watcherSession = {
      clientID: 980777,
      characterID: 140000001,
      solarsystemid2: TEST_SYSTEM_ID,
      socket: { destroyed: false },
      _space: {
        systemID: TEST_SYSTEM_ID,
        shipID: 140009999,
        initialStateSent: true,
      },
      notifications: [],
      sendNotification(notifyType, idType, payloadTuple = []) {
        this.notifications.push({ notifyType, idType, payloadTuple });
      },
    };
    const scene = spaceRuntime.ensureScene(TEST_SYSTEM_ID);
    scene.sessions.set(watcherSession.clientID, watcherSession);
    const watchedGate = scene.getEntityByID(WATCHED_GATE_ID);
    assert(watchedGate, "Expected watched stargate to exist in test scene");
    assert.strictEqual(
      watchedGate.activationState,
      CLOSED,
      "Watched gate should start closed before /loadallsys preloads its destination",
    );

    const loadAllResult = executeChatCommand(
      watcherSession,
      "/loadallsys",
      null,
      { emitChatFeedback: false },
    );
    assert.strictEqual(loadAllResult.handled, true, "loadallsys command should be handled");
    assert(
      loadAllResult.message.includes("/loadallsys"),
      "Feedback should mention the loadallsys command",
    );
    assert.strictEqual(
      watchedGate.activationState,
      ACTIVATING,
      "loadallsys should drive nearby closed gates into the activating state",
    );

    const activationUpdate = getDestinyUpdates(watcherSession.notifications).find(
      (entry) =>
        Array.isArray(entry.payload) &&
        entry.payload[0] === "OnSlimItemChange" &&
        entry.payload[1][0] === WATCHED_GATE_ID,
    );
    assert(
      activationUpdate,
      "Nearby watchers should receive a live OnSlimItemChange when loadallsys opens a gate",
    );
    assert.strictEqual(
      getDictValue(activationUpdate.payload[1][1].args, "activationState"),
      ACTIVATING,
      "The live loadallsys gate update should first report the activating state",
    );

    scene.tick(Date.now() + STARGATE_ACTIVATION_TRANSITION_MS + 1);
    assert.strictEqual(
      watchedGate.activationState,
      OPEN,
      "Activated loadallsys gates should settle into the open state after the transition window",
    );

    console.log(JSON.stringify({
      ok: true,
      testSystemID: TEST_SYSTEM_ID,
      destinationSystemIDs,
      message: result.message,
      loadAllMessage: loadAllResult.message,
      watchedGateID: WATCHED_GATE_ID,
      watchedGateState: watchedGate.activationState,
    }, null, 2));
  } finally {
    spaceRuntime._testing.clearScenes();
    spaceRuntime._testing.resetStargateActivationOverrides();
  }
}

main();
