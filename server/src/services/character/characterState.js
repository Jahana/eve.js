const log = require("../../utils/logger");
const database = require("../../database");
const { resolveShipByTypeID } = require("../chat/shipTypeRegistry");

const CHARACTERS_TABLE = "characters";
const DB_ROOT_PATH = "/";

// Kept for backwards-compatible exports. Data is now stored through database controller.
const LEGACY_DB_PATH = `${CHARACTERS_TABLE}:${DB_ROOT_PATH}`;
const SPLIT_DB_CHARACTERS_PATH = `${CHARACTERS_TABLE}:${DB_ROOT_PATH}`;

function readCharactersRoot() {
  const result = database.read(CHARACTERS_TABLE, DB_ROOT_PATH);
  if (!result.success || !result.data || typeof result.data !== "object") {
    return {};
  }

  return result.data;
}

function writeCharactersRoot(characters) {
  return database.write(CHARACTERS_TABLE, DB_ROOT_PATH, characters);
}

function readLegacyDb() {
  return {
    characters: readCharactersRoot(),
  };
}

function writeLegacyDb(data) {
  const characters = data && typeof data === "object" ? data.characters : null;
  writeCharactersRoot(
    characters && typeof characters === "object" ? characters : {},
  );
}

function readSplitCharacters() {
  return readCharactersRoot();
}

function writeSplitCharacters(data) {
  writeCharactersRoot(data && typeof data === "object" ? data : {});
}

function getCharacterRecord(charId) {
  const result = database.read(CHARACTERS_TABLE, `/${String(charId)}`);
  if (!result.success || !result.data || typeof result.data !== "object") {
    return null;
  }

  return result.data;
}

function updateCharacterRecord(charId, updater) {
  const charPath = `/${String(charId)}`;
  const characterResult = database.read(CHARACTERS_TABLE, charPath);
  if (!characterResult.success || !characterResult.data) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const existing = characterResult.data;
  const updated = typeof updater === "function" ? updater(existing) : updater;
  const writeResult = database.write(CHARACTERS_TABLE, charPath, updated);

  if (!writeResult.success) {
    return {
      success: false,
      errorMsg: writeResult.errorMsg || "WRITE_FAILED",
    };
  }

  return {
    success: true,
    data: updated,
  };
}

function toBigInt(value, fallback = 0n) {
  try {
    if (typeof value === "bigint") {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return BigInt(Math.trunc(value));
    }

    if (typeof value === "string" && value.trim() !== "") {
      return BigInt(value);
    }
  } catch (error) {
    return fallback;
  }

  return fallback;
}

function nextShipId(charId, currentShipId) {
  const baseShipId = Number.isInteger(currentShipId)
    ? currentShipId
    : Number(charId) + 100;
  return baseShipId + 1;
}

function normalizeSessionShipValue(value) {
  if (value === undefined || value === null || value === 0) {
    return null;
  }

  return value;
}

function applyCharacterToSession(session, charId, options = {}) {
  if (!session) {
    return {
      success: false,
      errorMsg: "SESSION_REQUIRED",
    };
  }

  const characterResult = database.read(CHARACTERS_TABLE, `/${String(charId)}`);
  const charData = characterResult.success ? characterResult.data : null;
  if (!charData) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const oldCharID = session.characterID;
  const oldCorpID = session.corporationID;
  const oldAllianceID = session.allianceID;
  const oldStationID = session.stationID || session.stationid || null;
  const oldSolarSystemID = session.solarsystemid2 || session.solarsystemid || null;
  const oldConstellationID = session.constellationID;
  const oldRegionID = session.regionID;
  const oldShipID = normalizeSessionShipValue(
    session.shipID ?? session.shipid ?? null,
  );
  const oldHqID = session.hqID;
  const oldBaseID = session.baseID;
  const oldWarFactionID = session.warFactionID;

  const stationID = charData.stationID || 60003760;
  const solarSystemID = charData.solarSystemID || 30000142;
  const shipID = charData.shipID || Number(charId) + 100;
  const shipTypeID =
    Number.isInteger(charData.shipTypeID) && charData.shipTypeID > 0
      ? charData.shipTypeID
      : 601;
  const shipMetadata = resolveShipByTypeID(shipTypeID);

  session.characterID = charId;
  session.characterName = charData.characterName || "Unknown";
  session.characterTypeID = charData.typeID || 1373;
  session.corporationID = charData.corporationID || 1000009;
  session.allianceID = charData.allianceID || 0;
  session.stationid = stationID;
  session.stationID = stationID;
  session.stationid2 = stationID;
  session.worldspaceid = stationID;
  session.locationid = stationID;
  session.solarsystemid2 = solarSystemID;
  session.solarsystemid = undefined;
  session.constellationID = charData.constellationID || 20000020;
  session.regionID = charData.regionID || 10000002;
  session.activeShipID = shipID;
  session.shipID = shipID;
  session.shipid = shipID;
  session.shipTypeID = shipTypeID;
  session.shipName =
    (shipMetadata && shipMetadata.name) || charData.shipName || "Ship";
  session.hqID = charData.hqID || 0;
  session.baseID = charData.baseID || 0;
  session.warFactionID = charData.warFactionID || 0;

  if (options.emitNotifications !== false) {
    session.sendNotification("OnCharacterSelected", "clientID", []);
    session.sendSessionChange({
      charid: [oldCharID || null, charId],
      corpid: [oldCorpID || null, session.corporationID],
      allianceid: [oldAllianceID || null, session.allianceID || null],
      stationid: [oldStationID || null, session.stationid],
      stationid2: [oldStationID || null, session.stationid2],
      worldspaceid: [null, session.worldspaceid],
      locationid: [null, session.locationid],
      solarsystemid2: [oldSolarSystemID || null, session.solarsystemid2],
      constellationid: [oldConstellationID || null, session.constellationID],
      regionid: [oldRegionID || null, session.regionID],
      shipid: [
        normalizeSessionShipValue(oldShipID),
        normalizeSessionShipValue(session.shipID),
      ],
      corprole: [null, 0n],
      rolesAtAll: [null, 0n],
      rolesAtBase: [null, 0n],
      rolesAtHQ: [null, 0n],
      rolesAtOther: [null, 0n],
      baseID: [oldBaseID || null, session.baseID || null],
      hqID: [oldHqID || null, session.hqID || null],
      warFactionID: [oldWarFactionID || null, session.warFactionID || null],
    });
  }

  if (options.logSelection !== false) {
    log.info(
      `[CharState] Applied ${session.characterName}(${charId}) ship=${session.shipName}(${session.shipTypeID}) activeShipID=${session.activeShipID} station=${session.stationid} system=${solarSystemID}`,
    );
  }

  return {
    success: true,
    data: charData,
  };
}

function setActiveShipForSession(session, shipType) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const docked = Boolean(session.stationid || session.stationID);
  if (!docked) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const charId = session.characterID;
  const currentRecord = getCharacterRecord(charId);
  if (currentRecord && currentRecord.shipTypeID === shipType.typeID) {
    const refreshResult = applyCharacterToSession(session, charId, {
      emitNotifications: true,
      logSelection: true,
    });

    return {
      ...refreshResult,
      changed: false,
    };
  }

  const updateResult = updateCharacterRecord(charId, (existing) => ({
    ...existing,
    shipTypeID: shipType.typeID,
    shipName: shipType.name,
    shipID: nextShipId(charId, existing.shipID),
  }));

  if (!updateResult.success) {
    return updateResult;
  }

  const applyResult = applyCharacterToSession(session, charId, {
    emitNotifications: true,
    logSelection: true,
  });

  return {
    ...applyResult,
    changed: true,
  };
}

module.exports = {
  LEGACY_DB_PATH,
  SPLIT_DB_CHARACTERS_PATH,
  readLegacyDb,
  writeLegacyDb,
  getCharacterRecord,
  updateCharacterRecord,
  applyCharacterToSession,
  setActiveShipForSession,
  toBigInt,
};
