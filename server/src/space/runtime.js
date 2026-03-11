const fs = require("fs");
const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const {
  updateShipItem,
} = require(path.join(__dirname, "../services/inventory/itemStore"));
const {
  currentFileTime,
} = require(path.join(__dirname, "../services/_shared/serviceHelpers"));
const worldData = require(path.join(__dirname, "./worldData"));
const destiny = require(path.join(__dirname, "./destiny"));

const ONE_AU_IN_METERS = 149597870700;
const MIN_WARP_DISTANCE_METERS = 150000;
const DEFAULT_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_RIGHT = Object.freeze({ x: 1, y: 0, z: 0 });
const VALID_MODES = new Set(["STOP", "GOTO", "FOLLOW", "WARP", "ORBIT"]);
const INCLUDE_STARGATES_IN_SCENE = false;
const DEFAULT_STATION_INTERACTION_RADIUS = 1000;
const DEFAULT_STATION_UNDOCK_DISTANCE = 8000;
const DEFAULT_STATION_DOCKING_RADIUS = 2500;
const STATION_DOCK_ACCEPT_DELAY_MS = 4000;
const LEGACY_STATION_NORMALIZATION_RADIUS = 100000;
const MOVEMENT_DEBUG_PATH = path.join(__dirname, "../../logs/space-movement-debug.log");
const DESTINY_DEBUG_PATH = path.join(__dirname, "../../logs/space-destiny-debug.log");
const WATCHER_CORRECTION_INTERVAL_MS = 500;
const WATCHER_POSITION_CORRECTION_INTERVAL_MS = 1000;
const MOVEMENT_TRACE_WINDOW_MS = 5000;
const MAX_SUBWARP_SPEED_FRACTION = 1.0;
const DESTINY_STAMP_INTERVAL_MS = 1000;
const DESTINY_STAMP_MAX_LEAD = 1;
const DESTINY_ACCEL_LOG_DENOMINATOR = Math.log(10000);
const DESTINY_ALIGN_LOG_DENOMINATOR = Math.log(4);
const TURN_ALIGNMENT_RADIANS = 4 * (Math.PI / 180);

let nextStamp = 0;
let nextMovementTraceID = 1;

function getCurrentDestinyStamp(now = Date.now()) {
  const numericNow = Number(now);
  const stampSource = Number.isFinite(numericNow)
    ? Math.floor(numericNow / DESTINY_STAMP_INTERVAL_MS)
    : Math.floor(Date.now() / DESTINY_STAMP_INTERVAL_MS);
  return (stampSource & 0x7fffffff) >>> 0;
}

function getMovementStamp(now = Date.now()) {
  return getCurrentDestinyStamp(now);
}

function getNextStamp(now = Date.now()) {
  const currentStamp = getCurrentDestinyStamp(now);
  const maxAllowedStamp = (currentStamp + DESTINY_STAMP_MAX_LEAD) >>> 0;
  if (nextStamp < currentStamp) {
    nextStamp = currentStamp;
    return nextStamp;
  }
  if (nextStamp >= maxAllowedStamp) {
    nextStamp = maxAllowedStamp;
    return nextStamp;
  }
  nextStamp = (nextStamp + 1) >>> 0;
  return nextStamp;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toFiniteNumber(value, fallback));
}

function roundNumber(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(toFiniteNumber(value, 0) * factor) / factor;
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

function dotProduct(left, right) {
  return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function crossProduct(left, right) {
  return {
    x: (left.y * right.z) - (left.z * right.y),
    y: (left.z * right.x) - (left.x * right.z),
    z: (left.x * right.y) - (left.y * right.x),
  };
}

function magnitude(vector) {
  return Math.sqrt((vector.x ** 2) + (vector.y ** 2) + (vector.z ** 2));
}

function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length <= 0) {
    return cloneVector(fallback);
  }

  return scaleVector(vector, 1 / length);
}

function distance(left, right) {
  return magnitude(subtractVectors(left, right));
}

function getTurnMetrics(currentDirection, targetDirection) {
  const current = normalizeVector(currentDirection, targetDirection);
  const target = normalizeVector(targetDirection, current);
  const alignment = clamp(dotProduct(current, target), -1, 1);
  const radians = Math.acos(alignment);
  const turnFraction = Math.sqrt(Math.max(0, (alignment + 1) * 0.5));
  return {
    alignment,
    radians: Number.isFinite(radians) ? radians : 0,
    turnFraction: Number.isFinite(turnFraction) ? turnFraction : 1,
  };
}

function summarizeVector(vector) {
  return {
    x: roundNumber(vector && vector.x),
    y: roundNumber(vector && vector.y),
    z: roundNumber(vector && vector.z),
  };
}

function isMovementTraceActive(entity, now = Date.now()) {
  return Boolean(
    entity &&
      entity.movementTrace &&
      Number(entity.movementTrace.untilMs || 0) > Number(now || Date.now()),
  );
}

function getMovementTraceSnapshot(entity, now = Date.now()) {
  if (!isMovementTraceActive(entity, now)) {
    return null;
  }

  return {
    id: toInt(entity.movementTrace.id, 0),
    reason: entity.movementTrace.reason || "unknown",
    stamp: toInt(entity.movementTrace.stamp, 0),
    ageMs: Math.max(0, toInt(now, Date.now()) - toInt(entity.movementTrace.startedAtMs, 0)),
    remainingMs: Math.max(0, toInt(entity.movementTrace.untilMs, 0) - toInt(now, Date.now())),
    context: entity.movementTrace.context || null,
  };
}

function armMovementTrace(entity, reason, context = {}, now = Date.now()) {
  if (!entity) {
    return null;
  }

  entity.movementTrace = {
    id: nextMovementTraceID++,
    reason,
    startedAtMs: now,
    untilMs: now + MOVEMENT_TRACE_WINDOW_MS,
    stamp: getCurrentDestinyStamp(now),
    context,
  };
  return entity.movementTrace;
}

function appendMovementDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(MOVEMENT_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      MOVEMENT_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write movement debug log: ${error.message}`);
  }
}

function appendDestinyDebug(entry) {
  try {
    fs.mkdirSync(path.dirname(DESTINY_DEBUG_PATH), { recursive: true });
    fs.appendFileSync(
      DESTINY_DEBUG_PATH,
      `[${new Date().toISOString()}] ${entry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SpaceRuntime] Failed to write destiny debug log: ${error.message}`);
  }
}

function buildPerpendicular(vector) {
  const direction = normalizeVector(vector, DEFAULT_RIGHT);
  const firstPass = crossProduct(direction, DEFAULT_UP);
  if (magnitude(firstPass) > 0) {
    return normalizeVector(firstPass, DEFAULT_RIGHT);
  }

  return normalizeVector(crossProduct(direction, DEFAULT_RIGHT), DEFAULT_UP);
}

function normalizeMode(value, fallback = "STOP") {
  return VALID_MODES.has(value) ? value : fallback;
}

function deriveAgilitySeconds(alignTime, maxAccelerationTime) {
  const accelSeconds =
    toFiniteNumber(maxAccelerationTime, 0) / DESTINY_ACCEL_LOG_DENOMINATOR;
  if (accelSeconds > 0) {
    return Math.max(accelSeconds, 0.05);
  }

  const alignSeconds =
    toFiniteNumber(alignTime, 0) / DESTINY_ALIGN_LOG_DENOMINATOR;
  if (alignSeconds > 0) {
    return Math.max(alignSeconds, 0.05);
  }

  return 1;
}

function deriveTurnDegreesPerTick(agilitySeconds) {
  const normalizedAgility = Math.max(toFiniteNumber(agilitySeconds, 0.05), 0.05);
  // The old linear falloff effectively stalled capital-class turns once
  // agility drifted past ~60s. Use a bounded inverse curve instead so large
  // hulls still converge in a finite, client-like amount of time while small
  // hulls retain noticeably sharper turns.
  return clamp(75 / normalizedAgility, 0.75, 12);
}

function slerpDirection(current, target, fraction, radians) {
  const clampedFraction = clamp(fraction, 0, 1);
  if (clampedFraction <= 0) {
    return current;
  }
  if (clampedFraction >= 1) {
    return target;
  }

  const totalRadians = Math.max(toFiniteNumber(radians, 0), 0);
  const sinTotal = Math.sin(totalRadians);
  if (!Number.isFinite(sinTotal) || Math.abs(sinTotal) < 0.000001) {
    return normalizeVector(
      addVectors(
        scaleVector(current, 1 - clampedFraction),
        scaleVector(target, clampedFraction),
      ),
      target,
    );
  }

  const leftWeight =
    Math.sin((1 - clampedFraction) * totalRadians) / sinTotal;
  const rightWeight =
    Math.sin(clampedFraction * totalRadians) / sinTotal;

  return normalizeVector(
    addVectors(
      scaleVector(current, leftWeight),
      scaleVector(target, rightWeight),
    ),
    target,
  );
}

function getStationConfiguredUndockDistance(station) {
  const undockPosition = station && station.undockPosition;
  if (!station || !station.position || !undockPosition) {
    return 0;
  }

  return distance(
    cloneVector(station.position),
    cloneVector(undockPosition),
  );
}

function hasRealStationDockData(station) {
  return Boolean(
    station &&
      station.dockPosition &&
      station.dockOrientation &&
      magnitude(cloneVector(station.dockOrientation)) > 0,
  );
}

function getStationDockPosition(station) {
  if (station && station.dockPosition) {
    return cloneVector(station.dockPosition, station.position);
  }

  return cloneVector(station && station.position);
}

function getStationDockDirection(station) {
  if (station && station.dockOrientation) {
    return normalizeVector(station.dockOrientation, DEFAULT_RIGHT);
  }

  return normalizeVector(
    station && station.undockDirection,
    DEFAULT_RIGHT,
  );
}

function getStationInteractionRadius(station) {
  const configuredVisualRadius = toFiniteNumber(station && station.radius, 0);
  if (configuredVisualRadius > 0) {
    return configuredVisualRadius;
  }

  const configuredRadius = toFiniteNumber(
    station && station.interactionRadius,
    0,
  );
  if (configuredRadius > 0) {
    return configuredRadius;
  }

  return DEFAULT_STATION_INTERACTION_RADIUS;
}

function getStationUndockSpawnState(station) {
  const storedUndockOffset = station
    ? subtractVectors(
        cloneVector(station.undockPosition, station.position),
        cloneVector(station.position),
      )
    : null;
  const direction = normalizeVector(
    magnitude(storedUndockOffset) > 0
      ? storedUndockOffset
      : cloneVector(
          station &&
            (station.dockOrientation || station.undockDirection),
          DEFAULT_RIGHT,
        ),
    DEFAULT_RIGHT,
  );
  const spawnDistance = Math.max(
    DEFAULT_STATION_UNDOCK_DISTANCE,
    getStationConfiguredUndockDistance(station),
    getStationInteractionRadius(station) + 2500,
  );

  return {
    direction,
    position: addVectors(
      cloneVector(station && station.position),
      scaleVector(direction, spawnDistance),
    ),
  };
}

function getCommandDirection(entity, fallback = DEFAULT_RIGHT) {
  if (entity && entity.targetPoint && entity.position) {
    return normalizeVector(
      subtractVectors(entity.targetPoint, entity.position),
      entity.direction || fallback,
    );
  }

  return normalizeVector(entity && entity.direction, fallback);
}

function getShipDockingDistanceToStation(entity, station) {
  if (!entity || !station) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    distance(entity.position, station.position) -
      entity.radius -
      getStationInteractionRadius(station),
  );
}

function canShipDockAtStation(entity, station, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
  return getShipDockingDistanceToStation(entity, station) <= Math.max(0, toFiniteNumber(maxDistance, DEFAULT_STATION_DOCKING_RADIUS));
}

function buildDockingDebugState(entity, station, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
  if (!entity || !station) {
    return null;
  }

  const dockPosition =
    station.dockPosition || station.undockPosition || station.position;

  return {
    canDock: canShipDockAtStation(entity, station, maxDistance),
    dockingDistance: roundNumber(
      getShipDockingDistanceToStation(entity, station),
    ),
    distanceToStationCenter: roundNumber(distance(entity.position, station.position)),
    distanceToDockPoint: roundNumber(distance(entity.position, dockPosition)),
    dockingThreshold: roundNumber(maxDistance),
    shipRadius: roundNumber(entity.radius),
    stationRadius: roundNumber(getStationInteractionRadius(station)),
    shipPosition: summarizeVector(entity.position),
    shipVelocity: summarizeVector(entity.velocity),
    stationPosition: summarizeVector(station.position),
    dockPosition: summarizeVector(dockPosition),
    targetEntityID: entity.targetEntityID || 0,
    dockingTargetID: entity.dockingTargetID || 0,
    mode: entity.mode,
    speedFraction: roundNumber(entity.speedFraction, 3),
  };
}

function snapShipToStationPerimeter(entity, station) {
  const desiredDistance = Math.max(
    DEFAULT_STATION_UNDOCK_DISTANCE,
    getStationConfiguredUndockDistance(station),
    getStationInteractionRadius(station) + entity.radius + 500,
  );
  const approachDirection = normalizeVector(
    subtractVectors(entity.position, station.position),
    cloneVector(station.undockDirection, DEFAULT_RIGHT),
  );

  entity.position = addVectors(
    cloneVector(station.position),
    scaleVector(approachDirection, desiredDistance),
  );
  entity.targetPoint = cloneVector(station.position);
}

function getLegacyStationNormalizationTarget(entity) {
  if (!entity || entity.kind !== "ship") {
    return null;
  }

  if (
    entity.targetEntityID &&
    (entity.mode === "FOLLOW" || entity.mode === "GOTO")
  ) {
    const trackedStation = worldData.getStationByID(entity.targetEntityID);
    if (trackedStation && canShipDockAtStation(entity, trackedStation)) {
      return trackedStation;
    }
  }

  if (
    entity.mode !== "STOP" ||
    toFiniteNumber(entity.speedFraction, 0) > 0 ||
    magnitude(entity.velocity) > 1
  ) {
    return null;
  }

  let closestStation = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const station of worldData.getStationsForSystem(entity.systemID)) {
    const stationDistance = getShipDockingDistanceToStation(entity, station);
    if (stationDistance < closestDistance) {
      closestDistance = stationDistance;
      closestStation = station;
    }
  }

  return closestDistance <= LEGACY_STATION_NORMALIZATION_RADIUS ? closestStation : null;
}

function normalizeLegacyStationState(entity) {
  if (
    !entity ||
    entity.kind !== "ship"
  ) {
    return false;
  }

  const station = getLegacyStationNormalizationTarget(entity);
  if (!station) {
    return false;
  }

  snapShipToStationPerimeter(entity, station);
  return true;
}

function serializeWarpState(entity) {
  if (!entity.warpState) {
    return null;
  }

  return {
    startTimeMs: toFiniteNumber(entity.warpState.startTimeMs, Date.now()),
    durationMs: toFiniteNumber(entity.warpState.durationMs, 0),
    accelTimeMs: toFiniteNumber(entity.warpState.accelTimeMs, 0),
    cruiseTimeMs: toFiniteNumber(entity.warpState.cruiseTimeMs, 0),
    decelTimeMs: toFiniteNumber(entity.warpState.decelTimeMs, 0),
    totalDistance: toFiniteNumber(entity.warpState.totalDistance, 0),
    stopDistance: toFiniteNumber(entity.warpState.stopDistance, 0),
    maxWarpSpeedMs: toFiniteNumber(entity.warpState.maxWarpSpeedMs, 0),
    warpSpeed: toInt(entity.warpState.warpSpeed, 30),
    effectStamp: toInt(entity.warpState.effectStamp, 0),
    targetEntityID: toInt(entity.warpState.targetEntityID, 0),
    followID: toInt(entity.warpState.followID, 0),
    followRangeMarker: toFiniteNumber(
      entity.warpState.followRangeMarker,
      entity.warpState.stopDistance,
    ),
    origin: cloneVector(entity.warpState.origin, entity.position),
    rawDestination: cloneVector(entity.warpState.rawDestination, entity.position),
    targetPoint: cloneVector(entity.warpState.targetPoint, entity.position),
  };
}

function serializeSpaceState(entity) {
  return {
    systemID: entity.systemID,
    position: cloneVector(entity.position),
    velocity: cloneVector(entity.velocity),
    direction: cloneVector(entity.direction),
    targetPoint: cloneVector(entity.targetPoint, entity.position),
    speedFraction: entity.speedFraction,
    mode: normalizeMode(entity.mode),
    targetEntityID: entity.targetEntityID || null,
    followRange: entity.followRange || 0,
    orbitDistance: entity.orbitDistance || 0,
    orbitNormal: cloneVector(entity.orbitNormal, buildPerpendicular(entity.direction)),
    orbitSign: entity.orbitSign < 0 ? -1 : 1,
    warpState: serializeWarpState(entity),
  };
}

function isReadyForDestiny(session) {
  return Boolean(
    session &&
      session._space &&
      session._space.initialStateSent &&
      session.socket &&
      !session.socket.destroyed,
  );
}

function buildShipPrimeUpdates(entity, stampOverride = null) {
  if (!entity || entity.kind !== "ship") {
    return [];
  }

  const stamp = stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());
  return [
    {
      stamp,
      payload: destiny.buildSetBallAgilityPayload(entity.itemID, entity.inertia),
    },
    {
      stamp,
      payload: destiny.buildSetBallMassPayload(entity.itemID, entity.mass),
    },
    {
      stamp,
      payload: destiny.buildSetMaxSpeedPayload(entity.itemID, entity.maxVelocity),
    },
    {
      stamp,
      payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
    },
  ];
}

function buildShipPrimeUpdatesForEntities(entities, stampOverride = null) {
  const updates = [];
  for (const entity of entities) {
    updates.push(...buildShipPrimeUpdates(entity, stampOverride));
  }
  return updates;
}

function buildPositionVelocityCorrectionUpdates(entity, options = {}) {
  const stamp = toInt(options.stamp, getMovementStamp());
  const updates = [];
  if (options.includePosition === true) {
    updates.push({
      stamp,
      payload: destiny.buildSetBallPositionPayload(entity.itemID, entity.position),
    });
  }
  updates.push({
    stamp,
    payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
  });
  return updates;
}

function summarizeDestinyArgs(name, args) {
  switch (name) {
    case "GotoDirection":
    case "SetBallVelocity":
    case "SetBallPosition":
      return [
        toInt(args && args[0], 0),
        roundNumber(args && args[1]),
        roundNumber(args && args[2]),
        roundNumber(args && args[3]),
      ];
    case "SetSpeedFraction":
      return [toInt(args && args[0], 0), roundNumber(args && args[1], 3)];
    case "FollowBall":
    case "Orbit":
      return [
        toInt(args && args[0], 0),
        toInt(args && args[1], 0),
        roundNumber(args && args[2]),
      ];
    case "Stop":
    case "AlignTo":
      return [toInt(args && args[0], 0)];
    case "WarpTo":
      return [
        toInt(args && args[0], 0),
        roundNumber(args && args[1]),
        roundNumber(args && args[2]),
        roundNumber(args && args[3]),
        toInt(args && args[4], 0),
        toInt(args && args[5], 0),
      ];
    case "AddBalls2":
      return ["omitted"];
    case "SetState":
      return ["omitted"];
    default:
      return args;
  }
}

function logDestinyDispatch(session, payloads, waitForBubble) {
  if (!session || payloads.length === 0) {
    return;
  }

  const dispatchDestinyStamp = getCurrentDestinyStamp();
  const stampLeads = payloads.map((update) => (
    toInt(update && update.stamp, 0) - dispatchDestinyStamp
  ));
  appendDestinyDebug(JSON.stringify({
    event: "destiny.send",
    charID: session.characterID || 0,
    shipID: session._space ? session._space.shipID || 0 : 0,
    systemID: session._space ? session._space.systemID || 0 : 0,
    waitForBubble: Boolean(waitForBubble),
    dispatchDestinyStamp,
    maxLeadFromDispatch: stampLeads.length > 0 ? Math.max(...stampLeads) : 0,
    updates: payloads.map((update) => ({
      stamp: toInt(update && update.stamp, 0),
      leadFromDispatch: toInt(update && update.stamp, 0) - dispatchDestinyStamp,
      name: update && update.payload ? update.payload[0] : null,
      args: summarizeDestinyArgs(
        update && update.payload ? update.payload[0] : null,
        update && update.payload ? update.payload[1] : null,
      ),
    })),
  }, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function clearPendingDock(entity) {
  if (entity) {
    entity.pendingDock = null;
  }
}

function logMovementDebug(event, entity, extra = {}) {
  if (!entity) {
    return;
  }

  const now = Date.now();
  appendMovementDebug(JSON.stringify({
    event,
    atMs: now,
    destinyStamp: getCurrentDestinyStamp(now),
    charID: entity.characterID || 0,
    shipID: entity.itemID || 0,
    systemID: entity.systemID || 0,
    mode: entity.mode || "UNKNOWN",
    speedFraction: roundNumber(entity.speedFraction, 3),
    position: summarizeVector(entity.position),
    velocity: summarizeVector(entity.velocity),
    direction: summarizeVector(entity.direction),
    targetPoint: summarizeVector(entity.targetPoint),
    targetEntityID: entity.targetEntityID || 0,
    dockingTargetID: entity.dockingTargetID || 0,
    speed: roundNumber(magnitude(entity.velocity), 3),
    turn: entity.lastTurnMetrics || null,
    motion: entity.lastMotionDebug || null,
    trace: getMovementTraceSnapshot(entity, now),
    ...extra,
  }));
}

function buildStaticStationEntity(station) {
  return {
    kind: "station",
    itemID: station.stationID,
    typeID: station.stationTypeID,
    groupID: station.groupID,
    categoryID: station.categoryID,
    itemName: station.stationName,
    ownerID: station.corporationID || 1,
    corporationID: station.corporationID || 0,
    allianceID: 0,
    warFactionID: 0,
    radius: getStationInteractionRadius(station),
    position: cloneVector(station.position),
    dockPosition: station.dockPosition
      ? cloneVector(station.dockPosition)
      : null,
    dockOrientation: station.dockOrientation
      ? normalizeVector(station.dockOrientation, station.undockDirection || DEFAULT_RIGHT)
      : normalizeVector(station.undockDirection, DEFAULT_RIGHT),
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticCelestialEntity(celestial) {
  return {
    kind: celestial.kind || "celestial",
    itemID: celestial.itemID,
    typeID: celestial.typeID,
    groupID: celestial.groupID,
    categoryID: celestial.categoryID,
    itemName: celestial.itemName,
    ownerID: 1,
    radius: celestial.radius || (celestial.groupID === 10 ? 15000 : 1000),
    position: cloneVector(celestial.position),
    velocity: { x: 0, y: 0, z: 0 },
  };
}

function buildStaticStargateEntity(stargate) {
  return {
    kind: "stargate",
    itemID: stargate.itemID,
    typeID: stargate.typeID,
    groupID: 10,
    categoryID: 3,
    itemName: stargate.itemName,
    ownerID: 1,
    radius: stargate.radius || 15000,
    position: cloneVector(stargate.position),
    velocity: { x: 0, y: 0, z: 0 },
    destinationID: stargate.destinationID,
    destinationSolarSystemID: stargate.destinationSolarSystemID,
  };
}

function buildWarpState(rawWarpState, position, warpSpeedAU) {
  if (!rawWarpState || typeof rawWarpState !== "object") {
    return null;
  }

  return {
    startTimeMs: toFiniteNumber(rawWarpState.startTimeMs, Date.now()),
    durationMs: toFiniteNumber(rawWarpState.durationMs, 0),
    accelTimeMs: toFiniteNumber(rawWarpState.accelTimeMs, 0),
    cruiseTimeMs: toFiniteNumber(rawWarpState.cruiseTimeMs, 0),
    decelTimeMs: toFiniteNumber(rawWarpState.decelTimeMs, 0),
    totalDistance: toFiniteNumber(rawWarpState.totalDistance, 0),
    stopDistance: toFiniteNumber(rawWarpState.stopDistance, 0),
    maxWarpSpeedMs: toFiniteNumber(rawWarpState.maxWarpSpeedMs, 0),
    warpSpeed: toInt(rawWarpState.warpSpeed, Math.round(warpSpeedAU * 10)),
    effectStamp: toInt(rawWarpState.effectStamp, 0),
    targetEntityID: toInt(rawWarpState.targetEntityID, 0),
    followID: toInt(rawWarpState.followID, 0),
    followRangeMarker: toFiniteNumber(
      rawWarpState.followRangeMarker,
      rawWarpState.stopDistance,
    ),
    origin: cloneVector(rawWarpState.origin, position),
    rawDestination: cloneVector(rawWarpState.rawDestination, position),
    targetPoint: cloneVector(rawWarpState.targetPoint, position),
  };
}

function buildShipEntity(session, shipItem, systemID) {
  const movement =
    worldData.getMovementAttributesForType(shipItem.typeID) || null;
  const spaceState = shipItem.spaceState || {};
  const position = cloneVector(spaceState.position);
  const direction = normalizeVector(
    cloneVector(spaceState.direction, DEFAULT_RIGHT),
    DEFAULT_RIGHT,
  );
  const velocity = cloneVector(spaceState.velocity);
  const targetPoint = cloneVector(
    spaceState.targetPoint,
    addVectors(position, scaleVector(direction, 1.0e16)),
  );
  const maxVelocity =
    toFiniteNumber(movement && movement.maxVelocity, 0) > 0
      ? toFiniteNumber(movement.maxVelocity, 0)
      : 200;
  const warpSpeedAU =
    toFiniteNumber(movement && movement.warpSpeedMultiplier, 0) > 0
      ? toFiniteNumber(movement.warpSpeedMultiplier, 0)
      : 3;
  const alignTime =
    toFiniteNumber(movement && movement.alignTime, 0) > 0
      ? toFiniteNumber(movement.alignTime, 0)
      : 3;
  const maxAccelerationTime =
    toFiniteNumber(movement && movement.maxAccelerationTime, 0) > 0
      ? toFiniteNumber(movement.maxAccelerationTime, 0)
      : 6;
  const speedFraction = clamp(
    toFiniteNumber(spaceState.speedFraction, magnitude(velocity) > 0 ? 1 : 0),
    0,
    MAX_SUBWARP_SPEED_FRACTION,
  );
  const mode = normalizeMode(
    spaceState.mode,
    magnitude(velocity) > 0 ? "GOTO" : "STOP",
  );
  const orbitNormal = normalizeVector(
    cloneVector(spaceState.orbitNormal, buildPerpendicular(direction)),
    buildPerpendicular(direction),
  );

  return {
    kind: "ship",
    systemID,
    itemID: shipItem.itemID,
    typeID: shipItem.typeID,
    groupID: shipItem.groupID,
    categoryID: shipItem.categoryID,
    itemName: shipItem.itemName || session.shipName || "Ship",
    ownerID: shipItem.ownerID || session.characterID,
    characterID: session.characterID || 0,
    corporationID: session.corporationID || 0,
    allianceID: session.allianceID || 0,
    warFactionID: session.warFactionID || 0,
    position,
    velocity,
    direction,
    targetPoint,
    mode,
    speedFraction,
    mass:
      toFiniteNumber(movement && movement.mass, 0) > 0
        ? toFiniteNumber(movement.mass, 0)
        : 1_000_000,
    inertia:
      toFiniteNumber(movement && movement.inertia, 0) > 0
        ? toFiniteNumber(movement.inertia, 0)
        : 1,
    radius:
      toFiniteNumber(movement && movement.radius, 0) > 0
        ? toFiniteNumber(movement.radius, 0)
        : 50,
    maxVelocity,
    alignTime,
    maxAccelerationTime,
    agilitySeconds: deriveAgilitySeconds(alignTime, maxAccelerationTime),
    warpSpeedAU,
    targetEntityID: toInt(spaceState.targetEntityID, 0) || null,
    followRange: toFiniteNumber(spaceState.followRange, 0),
    orbitDistance: toFiniteNumber(spaceState.orbitDistance, 0),
    orbitNormal,
    orbitSign: toFiniteNumber(spaceState.orbitSign, 1) < 0 ? -1 : 1,
    warpState:
      mode === "WARP"
        ? buildWarpState(spaceState.warpState, position, warpSpeedAU)
        : null,
    dockingTargetID: null,
    pendingDock: null,
    session,
    lastPersistAt: 0,
    lastObserverCorrectionBroadcastAt: 0,
    lastObserverPositionBroadcastAt: 0,
    lastMovementDebugAt: 0,
    lastMotionDebug: null,
    movementTrace: null,
  };
}

function persistShipEntity(entity) {
  const result = updateShipItem(entity.itemID, (currentItem) => ({
    ...currentItem,
    locationID: entity.systemID,
    flagID: 0,
    spaceState: serializeSpaceState(entity),
  }));

  if (!result.success) {
    log.warn(
      `[SpaceRuntime] Failed to persist ship ${entity.itemID}: ${result.errorMsg}`,
    );
  }

  entity.lastPersistAt = Date.now();
}

function clearTrackingState(entity) {
  entity.targetEntityID = null;
  entity.followRange = 0;
  entity.orbitDistance = 0;
  entity.warpState = null;
  entity.dockingTargetID = null;
}

function resetEntityMotion(entity) {
  clearTrackingState(entity);
  entity.mode = "STOP";
  entity.speedFraction = 0;
  entity.velocity = { x: 0, y: 0, z: 0 };
  entity.targetPoint = cloneVector(entity.position);
}

function buildUndockMovement(entity, direction, speedFraction = 1) {
  clearTrackingState(entity);
  entity.direction = normalizeVector(direction, entity.direction);
  entity.targetPoint = addVectors(
    cloneVector(entity.position),
    scaleVector(entity.direction, 1.0e16),
  );
  entity.speedFraction = clamp(speedFraction, 0, MAX_SUBWARP_SPEED_FRACTION);
  entity.mode = "GOTO";
  entity.velocity = { x: 0, y: 0, z: 0 };
}

function rotateDirectionToward(
  currentDirection,
  targetDirection,
  deltaSeconds,
  agilitySeconds,
  currentSpeedFraction = 0,
) {
  const current = normalizeVector(currentDirection, targetDirection);
  const target = normalizeVector(targetDirection, current);
  const turnMetrics = getTurnMetrics(current, target);
  const degrees = (turnMetrics.radians * 180) / Math.PI;

  if (!Number.isFinite(turnMetrics.radians) || turnMetrics.radians <= TURN_ALIGNMENT_RADIANS) {
    return {
      direction: target,
      degrees,
      turnFraction: turnMetrics.turnFraction,
      turnPercent: 1,
      degPerTick: 0,
      maxStepDegrees: 0,
      turnSeconds: 0,
      snapped: true,
    };
  }

  // Destiny turns much faster than it changes speed, and from near-rest the
  // client effectively snaps to the requested heading before accelerating.
  if (currentSpeedFraction <= 0.1) {
    return {
      direction: target,
      degrees,
      turnFraction: turnMetrics.turnFraction,
      turnPercent: 1,
      degPerTick: 0,
      maxStepDegrees: 0,
      turnSeconds: 0,
      snapped: true,
    };
  }

  // Match the classic destiny turn shape more closely than a slow exponential
  // blend: heading changes in noticeable per-tick steps and large turns begin
  // by shedding speed while the nose swings through the arc.
  const degPerTick = deriveTurnDegreesPerTick(agilitySeconds);
  const tickScale = Math.max(deltaSeconds / 0.1, 0.05);
  const maxStepDegrees = degPerTick * tickScale;
  const turnPercent = clamp(maxStepDegrees / Math.max(degrees, 0.001), 0.001, 1);
  const turnSeconds = Math.max(agilitySeconds / 2.2, 0.05);
  return {
    direction: slerpDirection(current, target, turnPercent, turnMetrics.radians),
    degrees,
    turnFraction: turnMetrics.turnFraction,
    turnPercent,
    degPerTick,
    maxStepDegrees,
    turnSeconds,
    snapped: false,
  };
}

function deriveTurnSpeedCap(turnMetrics) {
  const baseCap = clamp(toFiniteNumber(turnMetrics && turnMetrics.turnFraction, 1), 0.1, 1);
  const radians = Math.max(0, toFiniteNumber(turnMetrics && turnMetrics.radians, 0));

  if (radians >= (2 * Math.PI) / 3) {
    return Math.max(0.12, baseCap ** 3);
  }
  if (radians >= Math.PI / 4) {
    return Math.max(0.15, baseCap ** 2);
  }

  return baseCap;
}

function applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds) {
  const previousPosition = cloneVector(entity.position);
  const previousVelocity = cloneVector(entity.velocity);
  const headingSource = normalizeVector(entity.direction, desiredDirection);
  const targetDirection = normalizeVector(desiredDirection, headingSource);
  const agilitySeconds = Math.max(
    toFiniteNumber(entity.agilitySeconds, 0) ||
      deriveAgilitySeconds(entity.alignTime, entity.maxAccelerationTime),
    0.05,
  );
  const currentSpeedFraction =
    entity.maxVelocity > 0
      ? Math.max(0, magnitude(entity.velocity) / entity.maxVelocity)
      : 0;
  const targetSpeedFraction =
    entity.maxVelocity > 0
      ? Math.max(0, desiredSpeed / entity.maxVelocity)
      : 0;
  const turnMetrics = getTurnMetrics(headingSource, targetDirection);
  let effectiveTargetSpeedFraction = targetSpeedFraction;
  let turnSpeedCap = targetSpeedFraction;
  let speedResponseSeconds = agilitySeconds;
  let speedDeltaFraction = Math.abs(currentSpeedFraction - effectiveTargetSpeedFraction);
  if (
    turnMetrics.radians > TURN_ALIGNMENT_RADIANS &&
    currentSpeedFraction > 0.1
  ) {
    // Large direction changes need a much harder temporary speed cap than the
    // normal accel/decel curve or the server carries too much momentum through
    // the old heading and snaps the client forward on the next resync.
    turnSpeedCap = deriveTurnSpeedCap(turnMetrics);
    effectiveTargetSpeedFraction = Math.min(
      targetSpeedFraction,
      turnSpeedCap,
    );
    speedDeltaFraction = Math.abs(
      currentSpeedFraction - effectiveTargetSpeedFraction,
    );
    const turnAngleRatio = clamp(turnMetrics.radians / Math.PI, 0, 1);
    speedResponseSeconds = Math.max(
      0.12,
      agilitySeconds *
        Math.max(speedDeltaFraction * (0.2 + (0.4 * turnAngleRatio)), 0.08),
    );
  }
  const nextSpeedFraction =
    effectiveTargetSpeedFraction +
    ((currentSpeedFraction - effectiveTargetSpeedFraction) *
      Math.exp(-(deltaSeconds / speedResponseSeconds)));
  const nextSpeed = Math.max(0, nextSpeedFraction * entity.maxVelocity);

  const turnStep = rotateDirectionToward(
    headingSource,
    targetDirection,
    deltaSeconds,
    agilitySeconds,
    currentSpeedFraction,
  );
  entity.direction = turnStep.direction;
  entity.velocity =
    nextSpeed <= 0.05
      ? { x: 0, y: 0, z: 0 }
      : scaleVector(entity.direction, nextSpeed);
  if (desiredSpeed <= 0.001 && magnitude(entity.velocity) < 0.1) {
    entity.velocity = { x: 0, y: 0, z: 0 };
  }

  entity.position = addVectors(
    entity.position,
    scaleVector(entity.velocity, deltaSeconds),
  );
  const positionDelta = subtractVectors(entity.position, previousPosition);
  const velocityDelta = subtractVectors(entity.velocity, previousVelocity);
  const appliedTurnMetrics = getTurnMetrics(headingSource, entity.direction);
  entity.lastTurnMetrics = {
    degrees: roundNumber(turnStep.degrees, 2),
    appliedDegrees: roundNumber((appliedTurnMetrics.radians * 180) / Math.PI, 2),
    turnFraction: roundNumber(turnMetrics.turnFraction, 3),
    currentSpeedFraction: roundNumber(currentSpeedFraction, 3),
    targetSpeedFraction: roundNumber(targetSpeedFraction, 3),
    effectiveTargetSpeedFraction: roundNumber(effectiveTargetSpeedFraction, 3),
    turnSpeedCap: roundNumber(turnSpeedCap, 3),
    speedDeltaFraction: roundNumber(speedDeltaFraction, 3),
    speedResponseSeconds: roundNumber(speedResponseSeconds, 3),
    agilitySeconds: roundNumber(agilitySeconds, 3),
    degPerTick: roundNumber(turnStep.degPerTick, 3),
    maxStepDegrees: roundNumber(turnStep.maxStepDegrees, 3),
    turnPercent: roundNumber(turnStep.turnPercent, 3),
    turnSeconds: roundNumber(turnStep.turnSeconds, 3),
    snapped: Boolean(turnStep.snapped),
  };
  entity.lastMotionDebug = {
    deltaSeconds: roundNumber(deltaSeconds, 4),
    previousPosition: summarizeVector(previousPosition),
    positionDelta: summarizeVector(positionDelta),
    previousVelocity: summarizeVector(previousVelocity),
    velocityDelta: summarizeVector(velocityDelta),
    headingSource: summarizeVector(headingSource),
    desiredDirection: summarizeVector(targetDirection),
    currentSpeed: roundNumber(magnitude(previousVelocity), 3),
    desiredSpeed: roundNumber(desiredSpeed, 3),
    nextSpeed: roundNumber(magnitude(entity.velocity), 3),
    turnAngleDegrees: roundNumber((turnMetrics.radians * 180) / Math.PI, 2),
    remainingTurnDegrees: roundNumber(turnStep.degrees, 2),
  };

  return {
    changed:
      distance(previousPosition, entity.position) > 1 ||
      distance(previousVelocity, entity.velocity) > 0.5,
  };
}

function advanceGotoMovement(entity, deltaSeconds) {
  const desiredDirection = getCommandDirection(entity, entity.direction);
  const desiredSpeed =
    entity.maxVelocity * clamp(entity.speedFraction, 0, MAX_SUBWARP_SPEED_FRACTION);
  return applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds);
}

function advanceFollowMovement(entity, target, deltaSeconds) {
  if (!target) {
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    entity.dockingTargetID = null;
    return { changed: true };
  }

  const targetPoint = cloneVector(target.position);
  const separation = subtractVectors(targetPoint, entity.position);
  const currentDistance = magnitude(separation);
  const desiredRange = Math.max(
    0,
    toFiniteNumber(entity.followRange, 0) +
      entity.radius +
      (target.radius || 0),
  );
  const gap = currentDistance - desiredRange;
  const targetSpeed = magnitude(target.velocity || { x: 0, y: 0, z: 0 });
  const desiredDirection =
    gap > 50
      ? normalizeVector(separation, entity.direction)
      : normalizeVector(target.velocity, normalizeVector(separation, entity.direction));
  const desiredSpeed =
    gap > 50
      ? Math.min(
          entity.maxVelocity,
          Math.max(targetSpeed, Math.max(gap * 0.5, entity.maxVelocity * 0.25)),
        )
      : Math.min(entity.maxVelocity, targetSpeed);

  entity.targetPoint = targetPoint;
  const movementResult = applyDesiredVelocity(
    entity,
    desiredDirection,
    desiredSpeed,
    deltaSeconds,
  );

  return movementResult;
}

function advanceOrbitMovement(entity, target, deltaSeconds) {
  if (!target) {
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    return { changed: true };
  }

  const radialVector = subtractVectors(entity.position, target.position);
  const radialDirection = normalizeVector(radialVector, buildPerpendicular(entity.direction));
  let orbitNormal = normalizeVector(entity.orbitNormal, buildPerpendicular(radialDirection));
  if (Math.abs(dotProduct(orbitNormal, radialDirection)) > 0.95) {
    orbitNormal = buildPerpendicular(radialDirection);
  }

  const tangentDirection = normalizeVector(
    scaleVector(crossProduct(orbitNormal, radialDirection), entity.orbitSign || 1),
    entity.direction,
  );
  const currentDistance = magnitude(radialVector);
  const desiredDistance = Math.max(
    toFiniteNumber(entity.orbitDistance, 0) + entity.radius + (target.radius || 0),
    entity.radius + (target.radius || 0) + 500,
  );
  const radialError = currentDistance - desiredDistance;
  const correction = scaleVector(
    radialDirection,
    clamp(-radialError / Math.max(desiredDistance, 1), -0.75, 0.75),
  );
  const desiredDirection = normalizeVector(
    addVectors(tangentDirection, correction),
    tangentDirection,
  );
  const desiredSpeed = clamp(
    Math.max(entity.maxVelocity * 0.35, Math.abs(radialError) * 0.5),
    0,
    entity.maxVelocity,
  );

  entity.orbitNormal = orbitNormal;
  entity.targetPoint = addVectors(
    target.position,
    scaleVector(radialDirection, desiredDistance),
  );
  return applyDesiredVelocity(entity, desiredDirection, desiredSpeed, deltaSeconds);
}

function buildWarpProfile(entity, destination, options = {}) {
  const rawDestination = cloneVector(destination, entity.position);
  const stopDistance = Math.max(0, toFiniteNumber(options.stopDistance, 0));
  const travelVector = subtractVectors(rawDestination, entity.position);
  const direction = normalizeVector(travelVector, entity.direction);
  const targetPoint = subtractVectors(rawDestination, scaleVector(direction, stopDistance));
  const totalDistance = distance(entity.position, targetPoint);
  if (totalDistance < MIN_WARP_DISTANCE_METERS) {
    return null;
  }

  const warpSpeedAU =
    toFiniteNumber(options.warpSpeedAU, 0) > 0
      ? toFiniteNumber(options.warpSpeedAU, 0)
      : entity.warpSpeedAU;
  const nominalWarpSpeedMs = Math.max(warpSpeedAU * ONE_AU_IN_METERS, 10000);
  const nominalAccelTimeMs = Math.max(1500, Math.min(4000, entity.alignTime * 500));
  const nominalDecelTimeMs = nominalAccelTimeMs;
  const nominalAccelDistance =
    0.5 * nominalWarpSpeedMs * (nominalAccelTimeMs / 1000);
  const nominalDecelDistance =
    0.5 * nominalWarpSpeedMs * (nominalDecelTimeMs / 1000);

  let accelTimeMs = nominalAccelTimeMs;
  let cruiseTimeMs = 0;
  let decelTimeMs = nominalDecelTimeMs;
  let maxWarpSpeedMs = nominalWarpSpeedMs;

  if (totalDistance > nominalAccelDistance + nominalDecelDistance) {
    const cruiseDistance = totalDistance - nominalAccelDistance - nominalDecelDistance;
    cruiseTimeMs = (cruiseDistance / nominalWarpSpeedMs) * 1000;
  } else {
    const accelSeconds = nominalAccelTimeMs / 1000;
    const decelSeconds = nominalDecelTimeMs / 1000;
    const accelRate = nominalWarpSpeedMs / accelSeconds;
    const decelRate = nominalWarpSpeedMs / decelSeconds;
    maxWarpSpeedMs = Math.sqrt((2 * totalDistance * accelRate * decelRate) / (accelRate + decelRate));
    accelTimeMs = (maxWarpSpeedMs / accelRate) * 1000;
    decelTimeMs = (maxWarpSpeedMs / decelRate) * 1000;
  }

  return {
    startTimeMs: Date.now(),
    durationMs: accelTimeMs + cruiseTimeMs + decelTimeMs,
    accelTimeMs,
    cruiseTimeMs,
    decelTimeMs,
    totalDistance,
    stopDistance,
    maxWarpSpeedMs,
    warpSpeed: Math.max(1, Math.round(warpSpeedAU * 10)),
    effectStamp: toInt(options.effectStamp, getNextStamp()),
    targetEntityID: toInt(options.targetEntityID, 0),
    followID: toInt(options.targetEntityID, 0),
    followRangeMarker: stopDistance,
    origin: cloneVector(entity.position),
    rawDestination,
    targetPoint,
  };
}

function getWarpProgress(warpState, now) {
  const elapsedMs = Math.max(0, toFiniteNumber(now, Date.now()) - warpState.startTimeMs);
  const accelMs = warpState.accelTimeMs;
  const cruiseMs = warpState.cruiseTimeMs;
  const decelMs = warpState.decelTimeMs;
  const accelSeconds = Math.max(accelMs / 1000, 0.001);
  const decelSeconds = Math.max(decelMs / 1000, 0.001);
  const accelRate = warpState.maxWarpSpeedMs / accelSeconds;
  const decelRate = warpState.maxWarpSpeedMs / decelSeconds;
  const accelDistance = 0.5 * warpState.maxWarpSpeedMs * accelSeconds;
  const cruiseDistance = warpState.maxWarpSpeedMs * (cruiseMs / 1000);

  if (elapsedMs >= warpState.durationMs) {
    return { complete: true, traveled: warpState.totalDistance, speed: 0 };
  }

  if (elapsedMs < accelMs) {
    const seconds = elapsedMs / 1000;
    return {
      complete: false,
      traveled: 0.5 * accelRate * (seconds ** 2),
      speed: accelRate * seconds,
    };
  }

  if (elapsedMs < accelMs + cruiseMs) {
    const seconds = (elapsedMs - accelMs) / 1000;
    return {
      complete: false,
      traveled: accelDistance + (warpState.maxWarpSpeedMs * seconds),
      speed: warpState.maxWarpSpeedMs,
    };
  }

  const seconds = (elapsedMs - accelMs - cruiseMs) / 1000;
  return {
    complete: false,
    traveled:
      accelDistance +
      cruiseDistance +
      (warpState.maxWarpSpeedMs * seconds) -
      (0.5 * decelRate * (seconds ** 2)),
    speed: Math.max(0, warpState.maxWarpSpeedMs - (decelRate * seconds)),
  };
}

function getWarpStopDistanceForTarget(shipEntity, targetEntity, minimumRange = 0) {
  const targetRadius = Math.max(0, toFiniteNumber(targetEntity && targetEntity.radius, 0));
  const desiredRange = Math.max(0, toFiniteNumber(minimumRange, 0));

  switch (targetEntity && targetEntity.kind) {
    case "planet":
      return Math.max(targetRadius + 1000000, desiredRange) + (shipEntity.radius * 2);
    case "sun":
      return Math.max(targetRadius + 5000000, desiredRange) + (shipEntity.radius * 2);
    case "station":
      return Math.max(Math.max(2500, targetRadius * 0.25), desiredRange) + (shipEntity.radius * 2);
    case "stargate":
      return Math.max(Math.max(2500, targetRadius * 0.3), desiredRange) + (shipEntity.radius * 2);
    default:
      return Math.max(Math.max(1000, targetRadius), desiredRange) + (shipEntity.radius * 2);
  }
}

function advanceMovement(entity, scene, deltaSeconds, now) {
  switch (entity.mode) {
    case "STOP":
      return applyDesiredVelocity(entity, entity.direction, 0, deltaSeconds);
    case "GOTO":
      return advanceGotoMovement(entity, deltaSeconds);
    case "FOLLOW":
      return advanceFollowMovement(
        entity,
        scene.getEntityByID(entity.targetEntityID),
        deltaSeconds,
      );
    case "ORBIT":
      return advanceOrbitMovement(
        entity,
        scene.getEntityByID(entity.targetEntityID),
        deltaSeconds,
      );
    case "WARP": {
      if (!entity.warpState) {
        entity.mode = "STOP";
        entity.speedFraction = 0;
        entity.velocity = { x: 0, y: 0, z: 0 };
        entity.targetPoint = cloneVector(entity.position);
        return { changed: false };
      }

      const previousPosition = cloneVector(entity.position);
      const previousVelocity = cloneVector(entity.velocity);
      const progress = getWarpProgress(entity.warpState, now);
      const direction = normalizeVector(
        subtractVectors(entity.warpState.targetPoint, entity.warpState.origin),
        entity.direction,
      );
      entity.direction = direction;
      entity.position = progress.complete
        ? cloneVector(entity.warpState.targetPoint)
        : addVectors(
            entity.warpState.origin,
            scaleVector(direction, progress.traveled),
          );
      entity.velocity = progress.complete
        ? { x: 0, y: 0, z: 0 }
        : scaleVector(direction, progress.speed);

      if (progress.complete) {
        entity.mode = "STOP";
        entity.speedFraction = 0;
        entity.targetPoint = cloneVector(entity.position);
        entity.warpState = null;
        return {
          changed:
            distance(previousPosition, entity.position) > 1 ||
            distance(previousVelocity, entity.velocity) > 0.5,
          warpCompleted: true,
        };
      }

      return {
        changed:
          distance(previousPosition, entity.position) > 1 ||
          distance(previousVelocity, entity.velocity) > 0.5,
      };
    }
    default:
      return { changed: false };
  }
}

class SolarSystemScene {
  constructor(systemID) {
    this.systemID = Number(systemID);
    this.system = worldData.getSolarSystemByID(this.systemID);
    this.sessions = new Map();
    this.dynamicEntities = new Map();
    this.lastTickAt = Date.now();
    this.staticEntities = [];
    this.staticEntitiesByID = new Map();

    for (const station of worldData.getStationsForSystem(this.systemID)) {
      const entity = buildStaticStationEntity(station);
      this.staticEntities.push(entity);
      this.staticEntitiesByID.set(entity.itemID, entity);
    }
    for (const celestial of worldData.getCelestialsForSystem(this.systemID)) {
      const entity = buildStaticCelestialEntity(celestial);
      this.staticEntities.push(entity);
      this.staticEntitiesByID.set(entity.itemID, entity);
    }
    if (INCLUDE_STARGATES_IN_SCENE) {
      for (const stargate of worldData.getStargatesForSystem(this.systemID)) {
        const entity = buildStaticStargateEntity(stargate);
        this.staticEntities.push(entity);
        this.staticEntitiesByID.set(entity.itemID, entity);
      }
    }
  }

  getAllVisibleEntities() {
    return [...this.staticEntities, ...this.dynamicEntities.values()];
  }

  getDynamicEntities() {
    return [...this.dynamicEntities.values()];
  }

  getEntityByID(entityID) {
    const numericID = Number(entityID);
    if (!numericID) {
      return null;
    }

    return (
      this.dynamicEntities.get(numericID) ||
      this.staticEntitiesByID.get(numericID) ||
      null
    );
  }

  getShipEntityForSession(session) {
    if (!session || !session._space) {
      return null;
    }

    return this.dynamicEntities.get(session._space.shipID) || null;
  }

  buildModeUpdates(entity, stampOverride = null) {
    const updates = [];
    const modeStamp = stampOverride === null ? getNextStamp() : toInt(stampOverride, getNextStamp());

    switch (entity.mode) {
      case "GOTO":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildGotoDirectionPayload(
            entity.itemID,
            getCommandDirection(entity, entity.direction),
          ),
        });
        break;
      case "FOLLOW":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildFollowBallPayload(
            entity.itemID,
            entity.targetEntityID,
            entity.followRange,
          ),
        });
        break;
      case "ORBIT":
        updates.push({
          stamp: modeStamp,
          payload: destiny.buildOrbitPayload(
            entity.itemID,
            entity.targetEntityID,
            entity.orbitDistance,
          ),
        });
        break;
      case "WARP":
        if (entity.warpState) {
          const warpStamp = entity.warpState.effectStamp || modeStamp;
          updates.push({
            stamp: warpStamp,
            payload: destiny.buildWarpToPayload(
              entity.itemID,
              entity.warpState.targetPoint,
              entity.warpState.stopDistance,
              entity.warpState.warpSpeed,
            ),
          });
          updates.push({
            stamp: warpStamp,
            payload: destiny.buildOnSpecialFXPayload(entity.itemID, "effects.Warping"),
          });
          updates.push({
            stamp: warpStamp,
            payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
          });
        }
        break;
      default:
        break;
    }

    if (entity.mode !== "WARP" && entity.speedFraction > 0) {
      updates.push({
        stamp: modeStamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }
    if (entity.mode !== "WARP" && magnitude(entity.velocity) > 0) {
      updates.push({
        stamp: modeStamp,
        payload: destiny.buildSetBallVelocityPayload(
          entity.itemID,
          entity.velocity,
        ),
      });
    }

    return updates;
  }

  attachSession(session, shipItem, options = {}) {
    if (!session || !shipItem) {
      return null;
    }

    const shipEntity = buildShipEntity(session, shipItem, this.systemID);
    normalizeLegacyStationState(shipEntity);
    if (options.spawnStopped) {
      resetEntityMotion(shipEntity);
    } else if (options.undockDirection) {
      buildUndockMovement(
        shipEntity,
        options.undockDirection,
        options.speedFraction ?? 1,
      );
    }

    session._space = {
      systemID: this.systemID,
      shipID: shipEntity.itemID,
      beyonceBound: Boolean(options.beyonceBound),
      initialStateSent: false,
      pendingUndockMovement: Boolean(options.pendingUndockMovement),
    };

    this.sessions.set(session.clientID, session);
    this.dynamicEntities.set(shipEntity.itemID, shipEntity);
    persistShipEntity(shipEntity);

    log.info(
      `[SpaceRuntime] Attached ${session.characterName || session.characterID} ship=${shipEntity.itemID} to system ${this.systemID}`,
    );

    if (options.broadcast !== false) {
      this.broadcastAddBalls([shipEntity], session);
    }

    return shipEntity;
  }

  detachSession(session, options = {}) {
    if (!session || !session._space) {
      return;
    }

    const entity = this.dynamicEntities.get(session._space.shipID) || null;
    this.sessions.delete(session.clientID);
    if (entity) {
      persistShipEntity(entity);
      this.dynamicEntities.delete(entity.itemID);
      if (options.broadcast !== false) {
        this.broadcastRemoveBall(entity.itemID, session);
      }
    }

    session._space = null;
  }

  markBeyonceBound(session) {
    if (session && session._space) {
      session._space.beyonceBound = true;
    }
  }

  sendDestinyUpdates(session, payloads, waitForBubble = false) {
    if (!session || payloads.length === 0) {
      return;
    }

    let groupedUpdates = [];
    let currentStamp = null;
    let firstGroup = true;
    const flushGroup = () => {
      if (groupedUpdates.length === 0) {
        return;
      }

      logDestinyDispatch(session, groupedUpdates, waitForBubble && firstGroup);
      session.sendNotification(
        "DoDestinyUpdate",
        "clientID",
        destiny.buildDestinyUpdatePayload(
          groupedUpdates,
          waitForBubble && firstGroup,
        ),
      );
      groupedUpdates = [];
      currentStamp = null;
      firstGroup = false;
    };

    for (const payload of payloads) {
      const stamp = Number(payload && payload.stamp);
      if (groupedUpdates.length === 0) {
        groupedUpdates.push(payload);
        currentStamp = stamp;
        continue;
      }

      if (stamp === currentStamp) {
        groupedUpdates.push(payload);
        continue;
      }

      flushGroup();
      groupedUpdates.push(payload);
      currentStamp = stamp;
    }

    flushGroup();
  }

  sendMovementUpdatesToSession(session, updates) {
    if (!session || !isReadyForDestiny(session) || updates.length === 0) {
      return;
    }

    this.sendDestinyUpdates(session, updates);
  }

  ensureInitialBallpark(session, options = {}) {
    if (!session || !session._space) {
      return false;
    }

    if (session._space.initialStateSent && options.force !== true) {
      return true;
    }

    const egoEntity = this.getShipEntityForSession(session);
    if (!egoEntity) {
      return false;
    }

    const dynamicEntities = this.getDynamicEntities();
    const visibleEntities = this.getAllVisibleEntities();
    // V23.02 expects destiny statestamps on a coarse shared clock, but space
    // bootstrap still needs a strict AddBalls2 -> SetState -> prime/mode order.
    const bootstrapBaseStamp = getCurrentDestinyStamp();
    const addBallsStamp = bootstrapBaseStamp;
    const setStateStamp = (bootstrapBaseStamp + 1) >>> 0;
    const primeStamp = setStateStamp;
    const modeStamp = setStateStamp;
    nextStamp = Math.max(nextStamp, modeStamp);

    this.sendDestinyUpdates(
      session,
      [
        {
          stamp: addBallsStamp,
          payload: destiny.buildAddBalls2Payload(addBallsStamp, dynamicEntities),
        },
      ],
      true,
    );

    this.sendDestinyUpdates(session, [
      {
        stamp: setStateStamp,
        payload: destiny.buildSetStatePayload(
          setStateStamp,
          this.system,
          egoEntity.itemID,
          visibleEntities,
        ),
      },
    ]);

    const primeUpdates = buildShipPrimeUpdatesForEntities(dynamicEntities, primeStamp);
    if (primeUpdates.length > 0) {
      this.sendDestinyUpdates(session, primeUpdates);
    }

    session._space.initialStateSent = true;

    const followUp = this.buildModeUpdates(egoEntity, modeStamp);
    if (followUp.length > 0) {
      this.sendDestinyUpdates(session, followUp);
    }

    session._space.pendingUndockMovement = false;
    return true;
  }

  broadcastAddBalls(entities, excludedSession = null) {
    if (entities.length === 0) {
      return;
    }

    const stamp = getNextStamp();
    const payload = {
      stamp,
      payload: destiny.buildAddBalls2Payload(stamp, entities),
    };

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      this.sendDestinyUpdates(session, [payload]);
      const primeUpdates = buildShipPrimeUpdatesForEntities(entities);
      if (primeUpdates.length > 0) {
        this.sendDestinyUpdates(session, primeUpdates);
      }
      const modeUpdates = [];
      for (const entity of entities) {
        modeUpdates.push(...this.buildModeUpdates(entity));
      }
      if (modeUpdates.length > 0) {
        this.sendDestinyUpdates(session, modeUpdates);
      }
    }
  }

  broadcastRemoveBall(entityID, excludedSession = null) {
    const update = {
      stamp: getNextStamp(),
      payload: destiny.buildRemoveBallsPayload([entityID]),
    };

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      this.sendDestinyUpdates(session, [update]);
    }
  }

  removeBallFromSession(session, entityID) {
    if (!session || !isReadyForDestiny(session) || !entityID) {
      return false;
    }

    const update = {
      stamp: getNextStamp(),
      payload: destiny.buildRemoveBallsPayload([entityID]),
    };
    this.sendDestinyUpdates(session, [update]);
    return true;
  }

  broadcastMovementUpdates(updates, excludedSession = null) {
    if (updates.length === 0) {
      return;
    }

    for (const session of this.sessions.values()) {
      if (session === excludedSession || !isReadyForDestiny(session)) {
        continue;
      }
      this.sendDestinyUpdates(session, updates);
    }
  }

  gotoDirection(session, direction) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = Date.now();
    const commandDirection = normalizeVector(direction, entity.direction);
    clearTrackingState(entity);
    entity.targetPoint = addVectors(
      cloneVector(entity.position),
      scaleVector(commandDirection, 1.0e16),
    );
    const speedFractionChanged = entity.speedFraction <= 0;
    if (speedFractionChanged) {
      entity.speedFraction = 1.0;
    }
    entity.mode = "GOTO";
    persistShipEntity(entity);
    armMovementTrace(entity, "goto", {
      commandDirection: summarizeVector(commandDirection),
    }, now);
    logMovementDebug("cmd.goto", entity, {
      commandDirection: summarizeVector(commandDirection),
    });

    const movementStamp = getMovementStamp(now);
    const updates = [
      {
        stamp: movementStamp,
        payload: destiny.buildGotoDirectionPayload(entity.itemID, commandDirection),
      },
    ];
    if (speedFractionChanged) {
      updates.push({
        stamp: updates[0].stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }

    this.broadcastMovementUpdates(updates);

    return true;
  }

  alignTo(session, targetEntityID) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (!entity || !target || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = Date.now();
    const commandDirection = normalizeVector(
      subtractVectors(target.position, entity.position),
      entity.direction,
    );
    clearTrackingState(entity);
    entity.targetPoint = addVectors(
      cloneVector(entity.position),
      scaleVector(commandDirection, 1.0e16),
    );
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 0.75;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    entity.mode = "GOTO";
    persistShipEntity(entity);
    armMovementTrace(entity, "align", {
      commandDirection: summarizeVector(commandDirection),
      alignTargetID: target.itemID,
      alignTargetPosition: summarizeVector(target.position),
    }, now);
    logMovementDebug("cmd.align", entity, {
      commandDirection: summarizeVector(commandDirection),
      alignTargetID: target.itemID,
      alignTargetPosition: summarizeVector(target.position),
    });

    const movementStamp = getMovementStamp(now);
    const updates = [
      {
        stamp: movementStamp,
        payload: destiny.buildAlignToPayload(entity.itemID),
      },
    ];
    if (speedFractionChanged) {
      updates.push({
        stamp: updates[0].stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }

    this.broadcastMovementUpdates(updates);

    return true;
  }

  followBall(session, targetEntityID, range = 0, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (
      !entity ||
      !target ||
      entity.itemID === target.itemID ||
      entity.mode === "WARP" ||
      entity.pendingDock
    ) {
      return false;
    }

    const now = Date.now();
    const dockingTargetID =
      target.kind === "station" &&
      Number(options.dockingTargetID || 0) === target.itemID
        ? target.itemID
        : null;
    const normalizedRange = Math.max(0, toFiniteNumber(range, 0));
    if (
      entity.mode === "FOLLOW" &&
      entity.targetEntityID === target.itemID &&
      entity.dockingTargetID === dockingTargetID &&
      Math.abs(toFiniteNumber(entity.followRange, 0) - normalizedRange) < 1
    ) {
      logMovementDebug("cmd.follow.duplicate", entity, {
        followTargetID: target.itemID,
        followRange: roundNumber(normalizedRange),
        dockingTargetID: dockingTargetID || 0,
      });
      return true;
    }

    clearTrackingState(entity);
    entity.mode = "FOLLOW";
    entity.targetEntityID = target.itemID;
    entity.dockingTargetID = dockingTargetID;
    entity.followRange = normalizedRange;
    entity.targetPoint = cloneVector(target.position);
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 1;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    persistShipEntity(entity);
    armMovementTrace(entity, "follow", {
      followTargetID: target.itemID,
      followRange: roundNumber(entity.followRange),
      followTargetPosition: summarizeVector(target.position),
      dockingTargetID: dockingTargetID || 0,
    }, now);
    logMovementDebug("cmd.follow", entity, {
      followTargetID: target.itemID,
      followRange: roundNumber(entity.followRange),
      followTargetKind: target.kind,
      followTargetPosition: summarizeVector(target.position),
      dockPosition:
        target.kind === "station" && target.dockPosition
          ? summarizeVector(target.dockPosition)
          : null,
      dockingDistance:
        target.kind === "station"
          ? roundNumber(getShipDockingDistanceToStation(entity, target))
          : null,
    });

    const movementStamp = getMovementStamp(now);
    const updates = [
      {
        stamp: movementStamp,
        payload: destiny.buildFollowBallPayload(
          entity.itemID,
          target.itemID,
          entity.followRange,
        ),
      },
    ];
    if (speedFractionChanged) {
      updates.push({
        stamp: updates[0].stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }

    this.broadcastMovementUpdates(updates);

    return true;
  }

  orbit(session, targetEntityID, distanceValue = 0) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (
      !entity ||
      !target ||
      entity.itemID === target.itemID ||
      entity.mode === "WARP" ||
      entity.pendingDock
    ) {
      return false;
    }

    const now = Date.now();
    const radial = normalizeVector(
      subtractVectors(entity.position, target.position),
      buildPerpendicular(entity.direction),
    );

    clearTrackingState(entity);
    entity.mode = "ORBIT";
    entity.targetEntityID = target.itemID;
    entity.orbitDistance = Math.max(0, toFiniteNumber(distanceValue, 0));
    entity.orbitNormal = normalizeVector(
      crossProduct(radial, DEFAULT_UP),
      buildPerpendicular(radial),
    );
    entity.orbitSign = 1;
    entity.targetPoint = cloneVector(target.position);
    const previousSpeedFraction = entity.speedFraction;
    entity.speedFraction = previousSpeedFraction > 0 ? previousSpeedFraction : 1;
    const speedFractionChanged =
      Math.abs(entity.speedFraction - previousSpeedFraction) > 0.000001;
    persistShipEntity(entity);
    armMovementTrace(entity, "orbit", {
      orbitTargetID: target.itemID,
      orbitDistance: roundNumber(entity.orbitDistance),
      orbitTargetPosition: summarizeVector(target.position),
    }, now);
    logMovementDebug("cmd.orbit", entity, {
      orbitTargetID: target.itemID,
      orbitDistance: roundNumber(entity.orbitDistance),
      orbitTargetPosition: summarizeVector(target.position),
    });

    const movementStamp = getMovementStamp(now);
    const updates = [
      {
        stamp: movementStamp,
        payload: destiny.buildOrbitPayload(
          entity.itemID,
          target.itemID,
          entity.orbitDistance,
        ),
      },
    ];
    if (speedFractionChanged) {
      updates.push({
        stamp: updates[0].stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      });
    }

    this.broadcastMovementUpdates(updates);

    return true;
  }

  warpToEntity(session, targetEntityID, options = {}) {
    const entity = this.getShipEntityForSession(session);
    const target = this.getEntityByID(targetEntityID);
    if (!entity || !target) {
      return {
        success: false,
        errorMsg: "TARGET_NOT_FOUND",
      };
    }

    const stopDistance = getWarpStopDistanceForTarget(
      entity,
      target,
      toFiniteNumber(options.minimumRange, 0),
    );
    return this.warpToPoint(session, target.position, {
      ...options,
      stopDistance,
      targetEntityID: target.itemID,
    });
  }

  warpToPoint(session, point, options = {}) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.pendingDock) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
      };
    }

    const warpState = buildWarpProfile(entity, point, {
      ...options,
      warpSpeedAU: options.warpSpeedAU || entity.warpSpeedAU,
      effectStamp: getNextStamp(),
    });
    if (!warpState) {
      return {
        success: false,
        errorMsg: "WARP_DISTANCE_TOO_CLOSE",
      };
    }

    clearTrackingState(entity);
    entity.mode = "WARP";
    entity.speedFraction = 1;
    entity.direction = normalizeVector(
      subtractVectors(warpState.targetPoint, entity.position),
      entity.direction,
    );
    entity.targetPoint = cloneVector(warpState.targetPoint);
    entity.targetEntityID = warpState.targetEntityID || null;
    entity.warpState = warpState;
    entity.velocity = { x: 0, y: 0, z: 0 };
    persistShipEntity(entity);

    const warpStamp = warpState.effectStamp;
    this.broadcastMovementUpdates([
      {
        stamp: warpStamp,
        payload: destiny.buildWarpToPayload(
          entity.itemID,
          warpState.targetPoint,
          warpState.stopDistance,
          warpState.warpSpeed,
        ),
      },
      {
        stamp: warpStamp,
        payload: destiny.buildOnSpecialFXPayload(entity.itemID, "effects.Warping"),
      },
      {
        stamp: warpStamp,
        payload: destiny.buildSetBallMassivePayload(entity.itemID, false),
      },
    ]);

    return {
      success: true,
      data: warpState,
    };
  }

  setSpeedFraction(session, fraction) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.mode === "WARP" || entity.pendingDock) {
      return false;
    }

    const now = Date.now();
    const normalizedFraction = clamp(fraction, 0, MAX_SUBWARP_SPEED_FRACTION);
    if (normalizedFraction <= 0) {
      return this.stop(session);
    }

    entity.speedFraction = normalizedFraction;
    if (entity.speedFraction > 0 && entity.mode === "STOP") {
      entity.mode = "GOTO";
      entity.targetPoint = addVectors(
        cloneVector(entity.position),
        scaleVector(entity.direction, 1.0e16),
      );
    }
    persistShipEntity(entity);
    armMovementTrace(entity, "speed", {
      requestedSpeedFraction: roundNumber(normalizedFraction, 3),
    }, now);
    logMovementDebug("cmd.speed", entity);

    const stamp = getMovementStamp(now);
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(
          entity.itemID,
          entity.speedFraction,
        ),
      },
    ]);

    return true;
  }

  stop(session) {
    const entity = this.getShipEntityForSession(session);
    if (!entity || entity.pendingDock) {
      return false;
    }

    const now = Date.now();
    const wasAlreadyStopped =
      entity.mode === "STOP" &&
      entity.speedFraction <= 0 &&
      magnitude(entity.velocity) < 0.1;
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.targetPoint = cloneVector(entity.position);
    clearTrackingState(entity);
    persistShipEntity(entity);
    armMovementTrace(entity, "stop", {}, now);
    logMovementDebug("cmd.stop", entity);

    if (wasAlreadyStopped) {
      return true;
    }

    const stamp = getMovementStamp(now);
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
    ]);

    return true;
  }

  acceptDocking(session, stationID) {
    const entity = this.getShipEntityForSession(session);
    const station = this.getEntityByID(stationID);
    if (!entity || !station || station.kind !== "station") {
      return {
        success: false,
        errorMsg: "STATION_NOT_FOUND",
      };
    }

    if (
      entity.pendingDock &&
      Number(entity.pendingDock.stationID || 0) === station.itemID
    ) {
      return {
        success: true,
        data: {
          acceptedAtFileTime: entity.pendingDock.acceptedAtFileTime,
          pending: true,
        },
      };
    }

    if (!canShipDockAtStation(entity, station)) {
      return {
        success: false,
        errorMsg: "DOCKING_APPROACH_REQUIRED",
      };
    }

    clearTrackingState(entity);
    entity.mode = "STOP";
    entity.speedFraction = 0;
    entity.velocity = { x: 0, y: 0, z: 0 };
    entity.targetPoint = cloneVector(entity.position);
    entity.pendingDock = {
      stationID: station.itemID,
      acceptedAtMs: Date.now(),
      completeAtMs: Date.now() + STATION_DOCK_ACCEPT_DELAY_MS,
      acceptedAtFileTime: currentFileTime(),
    };
    persistShipEntity(entity);
    logMovementDebug("dock.accepted", entity, {
      stationID: station.itemID,
      dockingState: buildDockingDebugState(entity, station),
    });

    const stamp = getNextStamp();
    this.broadcastMovementUpdates([
      {
        stamp,
        payload: destiny.buildSetSpeedFractionPayload(entity.itemID, 0),
      },
      {
        stamp,
        payload: destiny.buildStopPayload(entity.itemID),
      },
      {
        stamp,
        payload: destiny.buildSetBallVelocityPayload(entity.itemID, entity.velocity),
      },
    ]);

    if (session && typeof session.sendNotification === "function") {
      const dockingAcceptedPayload = destiny.buildOnDockingAcceptedPayload(
        entity.position,
        getStationDockPosition(station),
        station.itemID,
      );
      session.sendNotification(
        "OnDockingAccepted",
        "charid",
        [dockingAcceptedPayload],
      );
    }

    return {
      success: true,
      data: {
        acceptedAtFileTime: entity.pendingDock.acceptedAtFileTime,
      },
    };
  }

  tick(now) {
    const deltaSeconds = Math.max((now - this.lastTickAt) / 1000, 0.05);
    this.lastTickAt = now;

    const sharedUpdates = [];
    const watcherOnlyUpdates = [];
    const dockRequests = new Map();
    for (const entity of this.dynamicEntities.values()) {
      const traceActive = isMovementTraceActive(entity, now);
      if (entity.pendingDock) {
        if (
          entity.session &&
          entity.session._space &&
          now >= Number(entity.pendingDock.completeAtMs || 0)
        ) {
          dockRequests.set(entity.session.clientID, {
            session: entity.session,
            stationID: entity.pendingDock.stationID,
          });
        }
        continue;
      }

      const result = advanceMovement(entity, this, deltaSeconds, now);
      if (!result.changed) {
        if (traceActive) {
          logMovementDebug("trace.tick.idle", entity, {
            deltaSeconds: roundNumber(deltaSeconds, 4),
            correction: null,
          });
        }
        continue;
      }

      const observerNeedsPositionAnchor =
        entity.mode === "WARP" ||
        (now - entity.lastObserverPositionBroadcastAt) >=
          WATCHER_POSITION_CORRECTION_INTERVAL_MS;
      const correctionStamp = getMovementStamp(now);
      const correctionUpdates = buildPositionVelocityCorrectionUpdates(entity, {
        stamp: correctionStamp,
        includePosition: observerNeedsPositionAnchor,
      });
      const correctionDebug = {
        stamp: correctionStamp,
        includePosition: observerNeedsPositionAnchor,
        includeVelocity: true,
        target:
          entity.mode === "WARP"
            ? "pilot-and-watchers"
            : "watchers-only",
        dispatched: false,
      };

      if (entity.mode === "WARP") {
        sharedUpdates.push(...correctionUpdates);
        entity.lastObserverPositionBroadcastAt = now;
        correctionDebug.dispatched = correctionUpdates.length > 0;
      } else {
        if (now - entity.lastObserverCorrectionBroadcastAt >= WATCHER_CORRECTION_INTERVAL_MS) {
          watcherOnlyUpdates.push({
            excludedSession: entity.session || null,
            updates: correctionUpdates,
          });
          entity.lastObserverCorrectionBroadcastAt = now;
          correctionDebug.dispatched = correctionUpdates.length > 0;
          if (observerNeedsPositionAnchor) {
            entity.lastObserverPositionBroadcastAt = now;
          }
        }
      }

      if (traceActive) {
        logMovementDebug("trace.tick", entity, {
          deltaSeconds: roundNumber(deltaSeconds, 4),
          correction: correctionDebug,
          dockingState:
            entity.dockingTargetID && this.getEntityByID(entity.dockingTargetID)
              ? buildDockingDebugState(
                  entity,
                  this.getEntityByID(entity.dockingTargetID),
                )
              : null,
        });
      }

      if (
        entity.session &&
        entity.mode !== "STOP" &&
        (now - entity.lastMovementDebugAt) >= 2000
      ) {
        logMovementDebug("tick", entity, {
          deltaSeconds: roundNumber(deltaSeconds, 4),
          correction: correctionDebug,
          dockingState:
            entity.dockingTargetID && this.getEntityByID(entity.dockingTargetID)
              ? buildDockingDebugState(
                  entity,
                  this.getEntityByID(entity.dockingTargetID),
                )
              : null,
        });
        entity.lastMovementDebugAt = now;
      }

      if (result.warpCompleted) {
        sharedUpdates.push({
          stamp: getNextStamp(),
          payload: destiny.buildStopPayload(entity.itemID),
        });
        sharedUpdates.push({
          stamp: getNextStamp(),
          payload: destiny.buildSetBallMassivePayload(entity.itemID, true),
        });
      }

      if (now - entity.lastPersistAt >= 2000 || result.warpCompleted) {
        persistShipEntity(entity);
      }
    }

    if (dockRequests.size > 0) {
      const { dockSession } = require(path.join(__dirname, "./transitions"));
      for (const request of dockRequests.values()) {
        const result = dockSession(request.session, request.stationID);
        if (!result.success) {
          const entity = this.getShipEntityForSession(request.session);
          clearPendingDock(entity);
          log.warn(
            `[SpaceRuntime] Delayed dock failed for char=${request.session && request.session.characterID} station=${request.stationID}: ${result.errorMsg}`,
          );
        }
      }
    }

    this.broadcastMovementUpdates(sharedUpdates);
    for (const batch of watcherOnlyUpdates) {
      this.broadcastMovementUpdates(batch.updates, batch.excludedSession);
    }
  }
}

class SpaceRuntime {
  constructor() {
    this.scenes = new Map();
    this._tickHandle = setInterval(() => this.tick(), 100);
    if (this._tickHandle && typeof this._tickHandle.unref === "function") {
      this._tickHandle.unref();
    }
  }

  ensureScene(systemID) {
    const numericSystemID = Number(systemID);
    if (!this.scenes.has(numericSystemID)) {
      this.scenes.set(numericSystemID, new SolarSystemScene(numericSystemID));
    }
    return this.scenes.get(numericSystemID);
  }

  getSceneForSession(session) {
    if (!session || !session._space) {
      return null;
    }

    return this.scenes.get(Number(session._space.systemID)) || null;
  }

  getEntity(session, entityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.getEntityByID(entityID) : null;
  }

  attachSession(session, shipItem, options = {}) {
    if (session && session._space) {
      this.detachSession(session, { broadcast: false });
    }

    const numericSystemID =
      Number(options.systemID || session.solarsystemid || session.solarsystemid2 || 0);
    if (!numericSystemID) {
      return null;
    }

    const scene = this.ensureScene(numericSystemID);
    return scene.attachSession(session, shipItem, options);
  }

  detachSession(session, options = {}) {
    if (!session || !session._space) {
      return;
    }

    const scene = this.scenes.get(Number(session._space.systemID));
    if (scene) {
      scene.detachSession(session, options);
    } else {
      session._space = null;
    }
  }

  markBeyonceBound(session) {
    const scene = this.getSceneForSession(session);
    if (scene) {
      scene.markBeyonceBound(session);
    }
  }

  ensureInitialBallpark(session, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.ensureInitialBallpark(session, options) : false;
  }

  gotoDirection(session, direction) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.gotoDirection(session, direction) : false;
  }

  alignTo(session, targetEntityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.alignTo(session, targetEntityID) : false;
  }

  followBall(session, targetEntityID, range, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.followBall(session, targetEntityID, range, options) : false;
  }

  orbit(session, targetEntityID, distanceValue) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.orbit(session, targetEntityID, distanceValue) : false;
  }

  warpToEntity(session, targetEntityID, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.warpToEntity(session, targetEntityID, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  warpToPoint(session, point, options = {}) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.warpToPoint(session, point, options)
      : { success: false, errorMsg: "NOT_IN_SPACE" };
  }

  setSpeedFraction(session, fraction) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.setSpeedFraction(session, fraction) : false;
  }

  stop(session) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.stop(session) : false;
  }

  getStationInteractionRadius(station) {
    return getStationInteractionRadius(station);
  }

  getStationUndockSpawnState(station) {
    return getStationUndockSpawnState(station);
  }

  removeBallFromSession(session, entityID) {
    const scene = this.getSceneForSession(session);
    return scene ? scene.removeBallFromSession(session, entityID) : false;
  }

  canDockAtStation(session, stationID, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
    const entity = this.getEntity(session, session && session._space ? session._space.shipID : null);
    const station = worldData.getStationByID(stationID);
    if (!entity || !station) {
      return false;
    }

    return canShipDockAtStation(entity, station, maxDistance);
  }

  getDockingDebugState(session, stationID, maxDistance = DEFAULT_STATION_DOCKING_RADIUS) {
    const entity = this.getEntity(
      session,
      session && session._space ? session._space.shipID : null,
    );
    const station = worldData.getStationByID(stationID);
    return buildDockingDebugState(entity, station, maxDistance);
  }

  acceptDocking(session, stationID) {
    const scene = this.getSceneForSession(session);
    return scene
      ? scene.acceptDocking(session, stationID)
      : {
          success: false,
          errorMsg: "SCENE_NOT_FOUND",
        };
  }

  tick() {
    const now = Date.now();
    for (const scene of this.scenes.values()) {
      scene.tick(now);
    }
  }
}

module.exports = new SpaceRuntime();
