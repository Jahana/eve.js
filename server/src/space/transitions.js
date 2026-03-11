const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const sessionRegistry = require(path.join(
  __dirname,
  "../services/chat/sessionRegistry",
));
const {
  applyCharacterToSession,
  getCharacterRecord,
  getActiveShipRecord,
  updateCharacterRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../services/character/characterState"));
const {
  findShipItemById,
  moveShipToSpace,
  dockShipToStation,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const {
  snapshotSessionPresence,
  setCharacterOnlineState,
  broadcastStationGuestEvent,
} = require(path.join(__dirname, "../services/station/stationPresence"));
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

function buildSpawnStateNearPosition(position, radius = 0, fallbackDirection = { x: 1, y: 0, z: 0 }) {
  const safePosition = cloneVector(position);
  const direction = normalizeVector(safePosition, fallbackDirection);
  const offset = Math.max(toFiniteNumber(radius, 0) + 15000, 10000);

  return {
    direction,
    position: addVectors(safePosition, scaleVector(direction, offset)),
  };
}

function buildSpawnStateNearShip(anchor) {
  const direction = normalizeVector(anchor && anchor.direction, { x: 1, y: 0, z: 0 });
  const offset = Math.max(toFiniteNumber(anchor && anchor.radius, 0) + 2500, 2500);

  return {
    direction,
    position: addVectors(
      cloneVector(anchor && anchor.position),
      scaleVector(direction, -offset),
    ),
  };
}

function getOnlineSessionByCharacterID(characterID) {
  const numericCharacterID = Number(characterID || 0);
  if (!numericCharacterID) {
    return null;
  }

  return (
    sessionRegistry.getSessions().find(
      (candidate) => Number(candidate && candidate.characterID) === numericCharacterID,
    ) || null
  );
}

function getOnlineSessionByShipID(shipID) {
  const numericShipID = Number(shipID || 0);
  if (!numericShipID) {
    return null;
  }

  return (
    sessionRegistry.getSessions().find(
      (candidate) =>
        candidate &&
        candidate._space &&
        Number(candidate._space.shipID || 0) === numericShipID,
    ) || null
  );
}

function buildLiveShipAnchor(targetSession, itemName = null) {
  if (!targetSession || !targetSession._space) {
    return null;
  }

  const entity = spaceRuntime.getEntity(targetSession, targetSession._space.shipID);
  if (!entity || !entity.position) {
    return null;
  }

  return {
    itemID: entity.itemID,
    itemName:
      itemName ||
      targetSession.characterName ||
      targetSession.shipName ||
      `ship ${entity.itemID}`,
    kind: "ship",
    position: cloneVector(entity.position),
    direction: cloneVector(entity.direction, { x: 1, y: 0, z: 0 }),
    radius: toFiniteNumber(entity.radius, 0),
  };
}

function describeTeleportDestination(destination) {
  if (!destination) {
    return "unknown destination";
  }

  switch (destination.kind) {
    case "station":
      return `station ${destination.station.stationName || destination.station.itemName || destination.station.stationID}`;
    case "space":
      if (destination.anchor && destination.anchor.itemName) {
        return `${destination.anchor.itemName} in system ${destination.system.solarSystemName || destination.system.solarSystemID}`;
      }
      return `solar system ${destination.system.solarSystemName || destination.system.solarSystemID}`;
    default:
      return "unknown destination";
  }
}

function buildSpaceTeleportState(destination) {
  if (!destination || destination.kind !== "space" || !destination.system) {
    return {
      direction: { x: 1, y: 0, z: 0 },
      position: { x: 0, y: 0, z: 0 },
    };
  }

  if (destination.anchor && destination.anchor.kind === "ship") {
    return buildSpawnStateNearShip(destination.anchor);
  }

  if (destination.anchor && destination.anchor.position) {
    return buildSpawnStateNearPosition(
      destination.anchor.position,
      destination.anchor.radius,
    );
  }

  const fallbackStation = worldData.getStationsForSystem(destination.system.solarSystemID)[0];
  if (fallbackStation) {
    return spaceRuntime.getStationUndockSpawnState(fallbackStation);
  }

  const fallbackCelestial = worldData.getCelestialsForSystem(destination.system.solarSystemID)[0];
  if (fallbackCelestial) {
    return buildSpawnStateNearPosition(
      fallbackCelestial.position,
      fallbackCelestial.radius,
    );
  }

  const fallbackGate = worldData.getStargatesForSystem(destination.system.solarSystemID)[0];
  if (fallbackGate) {
    return buildSpawnStateNearPosition(fallbackGate.position, fallbackGate.radius);
  }

  return {
    direction: { x: 1, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
  };
}

function resolveTeleportDestination(targetID) {
  const numericTargetID = Number(targetID || 0);
  if (!Number.isInteger(numericTargetID) || numericTargetID <= 0) {
    return {
      success: false,
      errorMsg: "DESTINATION_NOT_FOUND",
    };
  }

  const station = worldData.getStationByID(numericTargetID);
  if (station) {
    return {
      success: true,
      data: {
        kind: "station",
        station,
      },
    };
  }

  const system = worldData.getSolarSystemByID(numericTargetID);
  if (system) {
    return {
      success: true,
      data: {
        kind: "space",
        system,
        anchor: null,
      },
    };
  }

  const celestial = worldData.getCelestialByID(numericTargetID);
  if (celestial) {
    return {
      success: true,
      data: {
        kind: "space",
        system: worldData.getSolarSystemByID(celestial.solarSystemID),
        anchor: celestial,
      },
    };
  }

  const stargate = worldData.getStargateByID(numericTargetID);
  if (stargate) {
    return {
      success: true,
      data: {
        kind: "space",
        system: worldData.getSolarSystemByID(stargate.solarSystemID),
        anchor: stargate,
      },
    };
  }

  const shipItem = findShipItemById(numericTargetID);
  if (shipItem) {
    const liveShipSession = getOnlineSessionByShipID(shipItem.itemID);
    const liveShipAnchor = buildLiveShipAnchor(liveShipSession, shipItem.itemName);
    if (liveShipSession && liveShipAnchor) {
      return {
        success: true,
        data: {
          kind: "space",
          system:
            worldData.getSolarSystemByID(liveShipSession._space.systemID) ||
            worldData.getSolarSystemByID(shipItem.spaceState && shipItem.spaceState.systemID) ||
            worldData.getSolarSystemByID(shipItem.locationID),
          anchor: liveShipAnchor,
        },
      };
    }

    if (shipItem.flagID === 0 && shipItem.spaceState) {
      return {
        success: true,
        data: {
          kind: "space",
          system:
            worldData.getSolarSystemByID(
              shipItem.spaceState.systemID || shipItem.locationID,
            ),
          anchor: {
            itemID: shipItem.itemID,
            itemName: shipItem.itemName,
            kind: "ship",
            position: cloneVector(shipItem.spaceState.position),
            direction: cloneVector(shipItem.spaceState.direction, { x: 1, y: 0, z: 0 }),
            radius: 2500,
          },
        },
      };
    }

    const shipStation = worldData.getStationByID(shipItem.locationID);
    if (shipStation) {
      return {
        success: true,
        data: {
          kind: "station",
          station: shipStation,
        },
      };
    }

    const shipSystem =
      worldData.getSolarSystemByID(shipItem.locationID) ||
      worldData.getSolarSystemByID(shipItem.spaceState && shipItem.spaceState.systemID);
    if (shipSystem) {
      return {
        success: true,
        data: {
          kind: "space",
          system: shipSystem,
          anchor: null,
        },
      };
    }
  }

  const character = getCharacterRecord(numericTargetID);
  if (character) {
    const onlineCharacterSession = getOnlineSessionByCharacterID(numericTargetID);
    if (onlineCharacterSession) {
      const liveCharacterAnchor = buildLiveShipAnchor(
        onlineCharacterSession,
        `${character.characterName || numericTargetID}'s ship`,
      );
      if (liveCharacterAnchor) {
        return {
          success: true,
          data: {
            kind: "space",
            system: worldData.getSolarSystemByID(onlineCharacterSession._space.systemID),
            anchor: liveCharacterAnchor,
          },
        };
      }
    }

    const characterStation = worldData.getStationByID(character.stationID);
    if (characterStation) {
      return {
        success: true,
        data: {
          kind: "station",
          station: characterStation,
        },
      };
    }

    const characterShip = getActiveShipRecord(numericTargetID);
    if (characterShip && characterShip.flagID === 0 && characterShip.spaceState) {
      return {
        success: true,
        data: {
          kind: "space",
          system: worldData.getSolarSystemByID(characterShip.spaceState.systemID),
          anchor: {
            itemID: characterShip.itemID,
            itemName: `${character.characterName || numericTargetID}'s ship`,
            kind: "ship",
            position: cloneVector(characterShip.spaceState.position),
            direction: cloneVector(characterShip.spaceState.direction, { x: 1, y: 0, z: 0 }),
            radius: 2500,
          },
        },
      };
    }

    const characterSystem = worldData.getSolarSystemByID(character.solarSystemID);
    if (characterSystem) {
      return {
        success: true,
        data: {
          kind: "space",
          system: characterSystem,
          anchor: null,
        },
      };
    }
  }

  return {
    success: false,
    errorMsg: "DESTINATION_NOT_FOUND",
  };
}

function syncOnlinePresenceForTeleport(session, previousPresence) {
  const currentPresence = snapshotSessionPresence(session);

  if (
    previousPresence &&
    (!currentPresence || currentPresence.stationID !== previousPresence.stationID)
  ) {
    broadcastOnCharNoLongerInStation(session, previousPresence.stationID);
  }

  if (
    currentPresence &&
    (!previousPresence || currentPresence.stationID !== previousPresence.stationID)
  ) {
    broadcastStationGuestEvent("OnCharNowInStation", currentPresence, {
      excludeSession: session,
    });
  }

  const onlineResult = setCharacterOnlineState(
    session.characterID,
    true,
    currentPresence ? { stationID: currentPresence.stationID } : {},
  );
  if (!onlineResult.success) {
    log.warn(
      `[SpaceTransition] Failed to refresh online presence for ${session.characterName || session.characterID}: ${onlineResult.errorMsg}`,
    );
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

function teleportSession(session, targetID) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip) {
    return {
      success: false,
      errorMsg: "SHIP_NOT_FOUND",
    };
  }

  const destinationResult = resolveTeleportDestination(targetID);
  if (!destinationResult.success || !destinationResult.data) {
    return {
      success: false,
      errorMsg: destinationResult.errorMsg || "DESTINATION_NOT_FOUND",
    };
  }

  const destination = destinationResult.data;
  const previousPresence = snapshotSessionPresence(session);
  const previousSpaceShipID =
    session && session._space ? Number(session._space.shipID || 0) : 0;
  const previousSystemID =
    session && session._space ? Number(session._space.systemID || 0) : 0;
  const sameSystemSpaceTeleport = Boolean(
    session &&
      session._space &&
      destination.kind === "space" &&
      destination.system &&
      Number(destination.system.solarSystemID || 0) === previousSystemID,
  );

  if (session._space && !sameSystemSpaceTeleport) {
    if (previousSpaceShipID > 0) {
      spaceRuntime.removeBallFromSession(session, previousSpaceShipID);
    }
    spaceRuntime.detachSession(session, { broadcast: true });
  }

  if (destination.kind === "station") {
    const dockResult = dockShipToStation(activeShip.itemID, destination.station.stationID);
    if (!dockResult.success) {
      return dockResult;
    }

    syncInventoryItemForSession(
      session,
      dockResult.data,
      {
        locationID: dockResult.previousData.locationID,
        flagID: dockResult.previousData.flagID,
        quantity: dockResult.previousData.quantity,
        singleton: dockResult.previousData.singleton,
        stacksize: dockResult.previousData.stacksize,
      },
      {
        emitCfgLocation: false,
      },
    );

    const updateResult = updateCharacterRecord(session.characterID, (record) => ({
      ...record,
      homeStationID:
        Number(record.homeStationID || record.cloneStationID || destination.station.stationID) ||
        destination.station.stationID,
      cloneStationID:
        Number(record.cloneStationID || record.homeStationID || destination.station.stationID) ||
        destination.station.stationID,
      stationID: destination.station.stationID,
      solarSystemID: destination.station.solarSystemID,
      worldSpaceID: destination.station.stationID,
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

    syncOnlinePresenceForTeleport(session, previousPresence);

    log.info(
      `[SpaceTransition] Teleported ${session.characterName || session.characterID} to station ${destination.station.stationID}`,
    );

    return {
      success: true,
      data: {
        kind: "station",
        destination,
        boundResult: buildBoundResult(session),
        summary: describeTeleportDestination(destination),
      },
    };
  }

  if (!destination.system) {
    return {
      success: false,
      errorMsg: "DESTINATION_NOT_FOUND",
    };
  }

  const spawnState = buildSpaceTeleportState(destination);
  const moveResult = moveShipToSpace(activeShip.itemID, destination.system.solarSystemID, {
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
    solarSystemID: destination.system.solarSystemID,
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

  if (sameSystemSpaceTeleport) {
    const repositionedEntity = spaceRuntime.repositionSession(
      session,
      moveResult.data,
      {
        position: spawnState.position,
        direction: spawnState.direction,
      },
    );

    if (!repositionedEntity) {
      spaceRuntime.detachSession(session, { broadcast: true });
      spaceRuntime.attachSession(session, moveResult.data, {
        systemID: destination.system.solarSystemID,
        beyonceBound: true,
        pendingUndockMovement: false,
        broadcast: true,
        spawnStopped: true,
      });
      spaceRuntime.ensureInitialBallpark(session, { force: true });
    }
  } else {
    spaceRuntime.attachSession(session, moveResult.data, {
      systemID: destination.system.solarSystemID,
      beyonceBound: true,
      pendingUndockMovement: false,
      broadcast: true,
      spawnStopped: true,
    });
    spaceRuntime.ensureInitialBallpark(session, { force: true });
  }

  syncOnlinePresenceForTeleport(session, previousPresence);

  log.info(
    `[SpaceTransition] Teleported ${session.characterName || session.characterID} to ${describeTeleportDestination(destination)}`,
  );

  return {
    success: true,
    data: {
      kind: "space",
      destination,
      boundResult: buildBoundResult(session),
      summary: describeTeleportDestination(destination),
    },
  };
}

module.exports = {
  buildBoundResult,
  undockSession,
  dockSession,
  restoreSpaceSession,
  jumpSessionViaStargate,
  teleportSession,
};
