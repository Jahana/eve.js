const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const sessionRegistry = require(path.join(
  __dirname,
  "../services/chat/sessionRegistry",
));
const {
  applyCharacterToSession,
  getActiveShipRecord,
  updateCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../services/character/characterState"));
const {
  moveShipToSpace,
  dockShipToStation,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const worldData = require(path.join(__dirname, "./worldData"));
const spaceRuntime = require(path.join(__dirname, "./runtime"));
const TRANSITION_GUARD_WINDOW_MS = 5000;

function buildBoundResult(session) {
  if (!session) {
    return null;
  }

  const preferredBoundId =
    session.currentBoundObjectID ||
    (session._boundObjectIDs && (session._boundObjectIDs.ship || session._boundObjectIDs.beyonce)) ||
    session.lastBoundObjectID ||
    null;
  if (!preferredBoundId) {
    return null;
  }

  return [preferredBoundId, currentFileTime()];
}

function beginTransition(session, kind, targetID = 0) {
  if (!session) {
    return false;
  }

  const now = Date.now();
  const activeTransition = session._transitionState || null;
  if (
    activeTransition &&
    activeTransition.kind === kind &&
    (now - Number(activeTransition.startedAt || 0)) < TRANSITION_GUARD_WINDOW_MS
  ) {
    return false;
  }

  session._transitionState = {
    kind,
    targetID: Number(targetID || 0) || 0,
    startedAt: now,
  };
  return true;
}

function endTransition(session, kind) {
  if (
    session &&
    session._transitionState &&
    session._transitionState.kind === kind
  ) {
    session._transitionState = null;
  }
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneVector(source = null, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(vector, 1 / length);
}

function distance(left, right) {
  const delta = subtractVectors(left, right);
  return Math.sqrt((delta.x ** 2) + (delta.y ** 2) + (delta.z ** 2));
}

function buildGateSpawnState(stargate) {
  const system = worldData.getSolarSystemByID(stargate.solarSystemID);
  const direction = normalizeVector(
    subtractVectors(
      cloneVector(stargate.position),
      cloneVector(system && system.position),
    ),
  );
  const offset = Math.max((stargate.radius || 15000) * 0.4, 5000);

  return {
    direction,
    position: addVectors(
      cloneVector(stargate.position),
      scaleVector(direction, offset),
    ),
  };
}

function broadcastOnCharNoLongerInStation(session, stationID) {
  if (!session || !stationID) {
    return;
  }

  const payload = [[
    session.characterID || 0,
    session.corporationID || 0,
    session.allianceID || 0,
    session.warFactionID || 0,
  ]];

  for (const guest of sessionRegistry.getSessions()) {
    if (guest === session) {
      continue;
    }

    const guestStationID = guest.stationid || guest.stationID || 0;
    if (guestStationID !== stationID) {
      continue;
    }

    guest.sendNotification("OnCharNoLongerInStation", "stationid", payload);
  }
}

function undockSession(session) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const stationID = Number(session.stationid || session.stationID || 0);
  if (!stationID) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const station = worldData.getStationByID(stationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "undock", stationID)) {
    return {
      success: false,
      errorMsg: "UNDOCK_IN_PROGRESS",
    };
  }

  try {
    const undockState = spaceRuntime.getStationUndockSpawnState(station);

    const moveResult = moveShipToSpace(activeShip.itemID, station.solarSystemID, {
      position: undockState.position,
      direction: undockState.direction,
      velocity: { x: 0, y: 0, z: 0 },
      speedFraction: 0,
      mode: "STOP",
      targetPoint: undockState.position,
    });
    if (!moveResult.success) {
      return moveResult;
    }

    syncInventoryItemForSession(
      session,
      moveResult.data,
      {
        locationID: moveResult.previousData.locationID,
        flagID: moveResult.previousData.flagID,
        quantity: moveResult.previousData.quantity,
        singleton: moveResult.previousData.singleton,
        stacksize: moveResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    broadcastOnCharNoLongerInStation(session, stationID);

    const updateResult = updateCharacterRecord(session.characterID, (record) => ({
      ...record,
      homeStationID:
        Number(record.homeStationID || record.cloneStationID || station.stationID) ||
        station.stationID,
      cloneStationID:
        Number(record.cloneStationID || record.homeStationID || station.stationID) ||
        station.stationID,
      stationID: null,
      solarSystemID: station.solarSystemID,
      worldSpaceID: 0,
    }));
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: station.solarSystemID,
      undockDirection: undockState.direction,
      speedFraction: 1,
      pendingUndockMovement: false,
      broadcast: true,
    });

    log.info(
      `[SpaceTransition] Undocked ${session.characterName || session.characterID} ship=${moveResult.data.itemID} station=${stationID} system=${station.solarSystemID}`,
    );

    return {
      success: true,
      data: {
        station,
        ship: moveResult.data,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "undock");
  }
}

function dockSession(session, stationID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  if (session.stationid || session.stationID) {
    return {
      success: false,
      errorMsg: "ALREADY_DOCKED",
    };
  }

  const targetStationID = Number(stationID || 0);
  const station = worldData.getStationByID(targetStationID);
  if (!station) {
    return {
      success: false,
      errorMsg: "STATION_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  if (!beginTransition(session, "dock", targetStationID)) {
    return {
      success: false,
      errorMsg: "DOCK_IN_PROGRESS",
    };
  }

  try {
    spaceRuntime.detachSession(session, { broadcast: true });

    const dockResult = dockShipToStation(activeShip.itemID, station.stationID);
    if (!dockResult.success) {
      return dockResult;
    }

    const updateResult = updateCharacterRecord(session.characterID, (record) => ({
      ...record,
      homeStationID:
        Number(record.homeStationID || record.cloneStationID || station.stationID) ||
        station.stationID,
      cloneStationID:
        Number(record.cloneStationID || record.homeStationID || station.stationID) ||
        station.stationID,
      stationID: station.stationID,
      solarSystemID: station.solarSystemID,
      worldSpaceID: station.stationID,
    }));
    if (!updateResult.success) {
      return updateResult;
    }

    const applyResult = applyCharacterToSession(session, session.characterID, {
      emitNotifications: true,
      logSelection: true,
      selectionEvent: false,
    });
    if (!applyResult.success) {
      return applyResult;
    }

    log.info(
      `[SpaceTransition] Docked ${session.characterName || session.characterID} ship=${activeShip.itemID} station=${station.stationID}`,
    );

    return {
      success: true,
      data: {
        station,
        boundResult: buildBoundResult(session),
      },
    };
  } finally {
    endTransition(session, "dock");
  }
}

function restoreSpaceSession(session) {
  if (!session || !session.characterID || session.stationid || session.stationID) {
    return false;
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || !activeShip.spaceState) {
    return false;
  }

  spaceRuntime.attachSession(session, activeShip, {
    systemID:
      activeShip.spaceState.systemID ||
      session.solarsystemid ||
      session.solarsystemid2,
    pendingUndockMovement: false,
    broadcast: true,
  });

  return true;
}

function jumpSessionViaStargate(session, fromStargateID, toStargateID) {
  if (!session || !session.characterID || !session._space) {
    return {
      success: false,
      errorMsg: "NOT_IN_SPACE",
    };
  }

  const sourceGate = worldData.getStargateByID(fromStargateID);
  const destinationGate =
    worldData.getStargateByID(toStargateID) ||
    worldData.getStargateByID(sourceGate && sourceGate.destinationID);
  if (!sourceGate || !destinationGate) {
    return {
      success: false,
      errorMsg: "STARGATE_NOT_FOUND",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const shipEntity = spaceRuntime.getEntity(session, activeShip.itemID);
  const sourceEntity = spaceRuntime.getEntity(session, sourceGate.itemID);
  if (shipEntity && sourceEntity) {
    const jumpDistance = distance(shipEntity.position, sourceEntity.position);
    if (jumpDistance > Math.max((sourceEntity.radius || 15000) * 2, 60000)) {
      return {
        success: false,
        errorMsg: "TOO_FAR_FROM_STARGATE",
      };
    }
  }

  const spawnState = buildGateSpawnState(destinationGate);
  spaceRuntime.detachSession(session, { broadcast: true });

  const moveResult = moveShipToSpace(activeShip.itemID, destinationGate.solarSystemID, {
    position: spawnState.position,
    direction: spawnState.direction,
    velocity: { x: 0, y: 0, z: 0 },
    speedFraction: 0,
    mode: "STOP",
    targetPoint: spawnState.position,
  });
  if (!moveResult.success) {
    return moveResult;
  }

  syncInventoryItemForSession(
    session,
    moveResult.data,
    {
      locationID: moveResult.previousData.locationID,
      flagID: moveResult.previousData.flagID,
      quantity: moveResult.previousData.quantity,
      singleton: moveResult.previousData.singleton,
      stacksize: moveResult.previousData.stacksize,
    },
    {
      emitCfgLocation: false,
    },
  );

  const updateResult = updateCharacterRecord(session.characterID, (record) => ({
    ...record,
    stationID: null,
    solarSystemID: destinationGate.solarSystemID,
    worldSpaceID: 0,
  }));
  if (!updateResult.success) {
    return updateResult;
  }

  const applyResult = applyCharacterToSession(session, session.characterID, {
    emitNotifications: true,
    logSelection: true,
    selectionEvent: false,
  });
  if (!applyResult.success) {
    return applyResult;
  }

  spaceRuntime.attachSession(session, moveResult.data, {
    systemID: destinationGate.solarSystemID,
    beyonceBound: true,
    pendingUndockMovement: false,
    broadcast: true,
  });
  spaceRuntime.ensureInitialBallpark(session, { force: true });

  log.info(
    `[SpaceTransition] Stargate jump ${session.characterName || session.characterID} ship=${activeShip.itemID} from=${sourceGate.itemID} to=${destinationGate.itemID}`,
  );

  return {
    success: true,
    data: {
      stargate: destinationGate,
      boundResult: buildBoundResult(session),
    },
  };
}

module.exports = {
  buildBoundResult,
  undockSession,
  dockSession,
  restoreSpaceSession,
  jumpSessionViaStargate,
};
