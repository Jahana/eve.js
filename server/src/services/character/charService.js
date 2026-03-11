/**
 * CHARACTER SERVICE
 * (skeleton code by AI, updated by Icey)
 *
 * handles character selection, creation, and related operations
 *
 * TODO: update support for new database controller
 */

const BaseService = require("../baseService");
const log = require("../../utils/logger");
const database = require("../../database");
const {
  applyCharacterToSession,
  getCharacterRecord,
} = require("./characterState");
const { restoreSpaceSession } = require("../../space/transitions");
const {
  ensureCharacterSkills,
  getCharacterSkillPointTotal,
} = require("../skills/skillState");

const { ensureCharacterInventory } = require("../inventory/itemStore");
const {
  snapshotSessionPresence,
  setCharacterOnlineState,
  broadcastStationGuestEvent,
} = require("../station/stationPresence");
const { removeCharacterFromChatRooms } = require("../chat/xmppStubServer");

const EMPIRE_BY_CORPORATION = Object.freeze({
  1000044: 500001,
  1000115: 500002,
  1000009: 500003,
  1000006: 500004,
});

function normalizeRpcText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (
      value.type === "wstring" ||
      value.type === "token" ||
      value.type === "string"
    ) {
      return normalizeRpcText(value.value);
    }

    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return normalizeRpcText(value.value);
    }
  }

  return String(value);
}

function normalizeRpcInt(value, fallback = 0) {
  if (value === undefined || value === null || value === false) {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (Buffer.isBuffer(value)) {
    return normalizeRpcInt(value.toString("utf8"), fallback);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }

    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  }

  if (typeof value === "object") {
    if (
      value.type === "long" ||
      value.type === "int" ||
      value.type === "integer"
    ) {
      return normalizeRpcInt(value.value, fallback);
    }

    if (value.type === "wstring" || value.type === "token") {
      return normalizeRpcInt(value.value, fallback);
    }

    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return normalizeRpcInt(value.value, fallback);
    }
  }

  return fallback;
}

function extractCharacterIdFromKwargs(kwargs) {
  if (!kwargs || typeof kwargs !== "object") {
    return 0;
  }

  const directKeys = ["characterID", "charID", "charid"];
  for (const key of directKeys) {
    if (!Object.prototype.hasOwnProperty.call(kwargs, key)) {
      continue;
    }

    const numeric = normalizeRpcInt(kwargs[key], 0);
    if (numeric > 0) {
      return numeric;
    }
  }

  if (!Array.isArray(kwargs.entries)) {
    return 0;
  }

  for (const [rawKey, rawValue] of kwargs.entries) {
    const key = normalizeRpcText(rawKey).trim().toLowerCase();
    if (key !== "characterid" && key !== "charid") {
      continue;
    }

    const numeric = normalizeRpcInt(rawValue, 0);
    if (numeric > 0) {
      return numeric;
    }
  }

  return 0;
}

function resolveCharacterIdForSelection(args, kwargs, session) {
  if (Array.isArray(args)) {
    for (const candidate of args) {
      const numeric = normalizeRpcInt(candidate, 0);
      if (numeric > 0) {
        return numeric;
      }
    }
  }

  const kwargCharacterId = extractCharacterIdFromKwargs(kwargs);
  if (kwargCharacterId > 0) {
    return kwargCharacterId;
  }

  if (session) {
    const fromSession = normalizeRpcInt(
      session.lastCreatedCharacterID || session.characterID || session.charid,
      0,
    );
    if (fromSession > 0) {
      return fromSession;
    }
  }

  const charactersResult = database.read("characters", "/");
  const characters =
    charactersResult.success &&
    charactersResult.data &&
    typeof charactersResult.data === "object"
      ? charactersResult.data
      : {};
  const accountId = normalizeRpcInt(session && session.userid, 0);

  const fallbackIds = Object.entries(characters)
    .filter(
      ([, record]) =>
        normalizeRpcInt(record && record.accountId, 0) === accountId,
    )
    .map(([id]) => normalizeRpcInt(id, 0))
    .filter((id) => id > 0)
    .sort((a, b) => b - a);

  return fallbackIds.length > 0 ? fallbackIds[0] : 0;
}

/**
 * Build a util.KeyVal PyObject — the only working PyObject type in V23.02
 */
function buildKeyVal(entries) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

class CharService extends BaseService {
  constructor() {
    super("charUnboundMgr");
  }

  _normalizeAllianceId(value) {
    const numeric = Number(value) || 0;
    return numeric > 0 ? numeric : null;
  }

  /**
   * GetCharactersToSelect — V23.02 client calls this locally, which
   * internally calls GetCharacterSelectionData remotely. This handler
   * may still be called by older clients.
   */
  Handle_GetCharactersToSelect(args, session) {
    log.info("[CharService] GetCharactersToSelect");

    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};
    const userId = session ? session.userid : 0;

    const charList = [];
    for (const [charId, charData] of Object.entries(characters)) {
      if (charData.accountId === userId) {
        charList.push(
          buildKeyVal([
            ["characterID", parseInt(charId, 10)],
            ["characterName", charData.characterName || "Unknown"],
            ["deletePrepareDateTime", null],
            ["gender", charData.gender || 1],
            ["typeID", charData.typeID || 1373],
          ]),
        );
      }
    }

    log.debug(
      `[CharService] Returning ${charList.length} characters for userId=${userId}`,
    );

    return { type: "list", items: charList };
  }

  /**
   * GetCharacterSelectionData — V23.02 primary entry point.
   *
   * From decompiled charselData.py line 31:
   *   userDetails, trainingDetails, characterDetails, wars = \
   *       self.charRemoteSvc.GetCharacterSelectionData()
   *
   * Returns 4-tuple: (userDetails, trainingDetails, characterDetails, wars)
   */
  Handle_GetCharacterSelectionData(args, session) {
    log.debug("[CharService] GetCharacterSelectionData");

    const accountResult = database.read("accounts", "/");
    const accounts = accountResult.success ? accountResult.data : {};

    const charactersResult = database.read("characters", "/");
    const characters = charactersResult.success ? charactersResult.data : {};

    const userId = session ? session.userid : 0;
    let accountUsername = "user";
    if (accounts) {
      for (const [username, acct] of Object.entries(accounts)) {
        if (acct.id === userId) {
          accountUsername = username;
          break;
        }
      }
    }

    const userDetailsKeyVal = buildKeyVal([
      ["characterSlots", 3],
      ["userName", accountUsername],
      ["creationDate", { type: "long", value: 132000000000000000 }],
      ["subscriptionEndTime", { type: "long", value: 253370764800000000 }],
      ["maxCharacterSlots", 3],
    ]);
    const userDetails = { type: "list", items: [userDetailsKeyVal] };

    const trainingDetails = [null, null];

    const characterDetails = [];
    for (const [charId, rawCharacter] of Object.entries(characters)) {
      if (rawCharacter.accountId === userId) {
        const character = getCharacterRecord(charId) || rawCharacter;
        const cid = parseInt(charId, 10);
        const allianceID = this._normalizeAllianceId(character.allianceID);
        const skillPoints =
          getCharacterSkillPointTotal(cid) || character.skillPoints || 50000;
        characterDetails.push(
          buildKeyVal([
            ["characterID", cid],
            ["characterName", character.characterName || "Unknown"],
            ["deletePrepareDateTime", null],
            ["gender", character.gender || 1],
            ["typeID", character.typeID || 1373],
            ["bloodlineID", character.bloodlineID || 1],
            ["corporationID", character.corporationID || 1000009],
            ["allianceID", allianceID],
            // Keep character-select payload close to upstream.
            // Exposing empire/school/faction state here caused the client to
            // incorrectly surface war/faction UI on the selection screen.
            ["factionID", null],
            ["stationID", character.stationID ?? null],
            ["solarSystemID", character.solarSystemID || 30000142],
            ["constellationID", character.constellationID || 20000020],
            ["regionID", character.regionID || 10000002],
            ["balance", character.balance ?? 100000.0],
            ["balanceChange", 0.0],
            ["skillPoints", skillPoints],
            ["shipTypeID", character.shipTypeID || 606],
            ["shipName", character.shipName || "Velator"],
            [
              "securityRating",
              character.securityStatus ?? character.securityRating ?? 0.0,
            ],
            [
              "securityStatus",
              character.securityStatus ?? character.securityRating ?? 0.0,
            ],
            ["title", character.title || ""],
            ["unreadMailCount", character.unreadMailCount || 0],
            ["paperdollState", character.paperDollState || 0],
            ["lockTypeID", null],
            [
              "logoffDate",
              {
                type: "long",
                value: character.logoffDate || 132000000000000000,
              },
            ],
            ["skillTypeID", null],
            ["toLevel", null],
            ["trainingStartTime", null],
            ["trainingEndTime", null],
            ["queueEndTime", null],
            ["finishSP", null],
            ["trainedSP", null],
            ["finishedSkills", { type: "list", items: [] }],
          ]),
        );
      }
    }

    const wars = { type: "list", items: [] };

    log.debug(
      `[CharService] GetCharacterSelectionData: returning ${characterDetails.length} chars`,
    );

    return [
      userDetails,
      trainingDetails,
      { type: "list", items: characterDetails },
      wars,
    ];
  }

  /**
   * GetCharacterToSelect — returns detailed info for one character
   */
  Handle_GetCharacterToSelect(args, session, kwargs) {
    let charId = args && args.length > 0 ? args[0] : 0;
    if (charId === 0 && kwargs && kwargs.entries) {
      const entry = kwargs.entries.find(
        (candidate) => candidate[0] === "characterID",
      );
      if (entry) {
        charId = entry[1];
      }
    }
    log.info(`[CharService] GetCharacterToSelect(${charId})`);

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};
    const character = getCharacterRecord(charId) || characters[String(charId)];
    const allianceID = this._normalizeAllianceId(
      character && character.allianceID,
    );
    const skillPoints =
      getCharacterSkillPointTotal(charId) ||
      (character && character.skillPoints) ||
      50000;

    if (!character) {
      log.warn(`[CharService] Character ${charId} not found`);
      return null;
    }

    return buildKeyVal([
      ["unreadMailCount", character.unreadMailCount || 0],
      ["upcomingEventCount", character.upcomingEventCount || 0],
      ["unprocessedNotifications", character.unprocessedNotifications || 0],
      ["characterID", parseInt(charId, 10)],
      ["petitionMessage", character.petitionMessage || ""],
      ["gender", character.gender || 1],
      ["bloodlineID", character.bloodlineID || 1],
      [
        "createDateTime",
        { type: "long", value: character.createDateTime || 132000000000000000 },
      ],
      [
        "startDateTime",
        { type: "long", value: character.startDateTime || 132000000000000000 },
      ],
      ["corporationID", character.corporationID || 1000009],
      ["worldSpaceID", character.worldSpaceID || 0],
      ["stationID", character.stationID ?? null],
      ["solarSystemID", character.solarSystemID || 30000142],
      ["constellationID", character.constellationID || 20000020],
      ["regionID", character.regionID || 10000002],
      ["allianceID", allianceID],
      [
        "allianceMemberStartDate",
        allianceID ? character.allianceMemberStartDate || 0 : null,
      ],
      ["shortName", character.shortName || "none"],
      ["bounty", character.bounty || 0.0],
      [
        "skillQueueEndTime",
        { type: "long", value: character.skillQueueEndTime || 0 },
      ],
      ["skillPoints", skillPoints],
      ["shipTypeID", character.shipTypeID || 606],
      ["shipName", character.shipName || "Ship"],
      [
        "securityRating",
        character.securityStatus ?? character.securityRating ?? 0.0,
      ],
      [
        "securityStatus",
        character.securityStatus ?? character.securityRating ?? 0.0,
      ],
      ["title", character.title || ""],
      ["balance", character.balance ?? 100000.0],
      ["aurBalance", character.aurBalance ?? 0.0],
      ["daysLeft", character.daysLeft || 365],
      ["userType", character.userType || 30],
      ["paperDollState", character.paperDollState || 0],
    ]);
  }

  /**
   * CreateCharacterWithDoll — V23.02 character creation
   * EVEmu signature: (characterName, bloodlineID, genderID, ancestryID, characterInfo, portraitInfo, schoolID)
   * Returns the new characterID
   */
  Handle_CreateCharacterWithDoll(args, session) {
    let characterName = args && args.length > 0 ? args[0] : "New Character";
    const bloodlineID = args && args.length > 1 ? args[1] : 1;
    const ancestryID = args && args.length > 2 ? args[2] : 1;
    const genderID = args && args.length > 3 ? args[3] : 1;
    const schoolID = args && args.length > 7 ? args[7] : 11;

    if (Buffer.isBuffer(characterName)) {
      characterName = characterName.toString("utf8");
    } else if (characterName && typeof characterName === "object") {
      characterName =
        characterName.value ||
        characterName.name ||
        JSON.stringify(characterName);
    }

    log.info(
      `[CharService] CreateCharacterWithDoll: name="${characterName}" bloodline=${bloodlineID} gender=${genderID} ancestry=${ancestryID} school=${schoolID}`,
    );

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};

    const existingIds = Object.keys(characters).map(Number);
    const newCharId =
      existingIds.length > 0 ? Math.max(...existingIds) + 1 : 140000001;

    const bloodlineInfo = {
      1: { raceID: 1, typeID: 1373, corpID: 1000006 },
      2: { raceID: 1, typeID: 1374, corpID: 1000006 },
      3: { raceID: 1, typeID: 1375, corpID: 1000009 },
      4: { raceID: 1, typeID: 1376, corpID: 1000009 },
      5: { raceID: 8, typeID: 1377, corpID: 1000115 },
      6: { raceID: 8, typeID: 1378, corpID: 1000115 },
      7: { raceID: 2, typeID: 1379, corpID: 1000044 },
      8: { raceID: 2, typeID: 1380, corpID: 1000044 },
      11: { raceID: 1, typeID: 1383, corpID: 1000009 },
      12: { raceID: 8, typeID: 1384, corpID: 1000115 },
      13: { raceID: 1, typeID: 1385, corpID: 1000006 },
      14: { raceID: 2, typeID: 1386, corpID: 1000044 },
    };

    const info = bloodlineInfo[bloodlineID] || {
      raceID: 1,
      typeID: 1373,
      corpID: 1000009,
    };
    const now = BigInt(Date.now()) * 10000n + 116444736000000000n;

    characters[String(newCharId)] = {
      accountId: session ? session.userid : 1,
      characterName:
        typeof characterName === "string" ? characterName : "New Character",
      gender: genderID,
      bloodlineID,
      ancestryID,
      raceID: info.raceID,
      typeID: info.typeID,
      corporationID: info.corpID,
      allianceID: 0,
      factionID: null,
      stationID: 60003760,
      homeStationID: 60003760,
      cloneStationID: 60003760,
      solarSystemID: 30000142,
      constellationID: 20000020,
      regionID: 10000002,
      createDateTime: now.toString(),
      startDateTime: now.toString(),
      logoffDate: now.toString(),
      deletePrepareDateTime: null,
      lockTypeID: null,
      securityRating: 0.0,
      title: "",
      description: "Character created via EVE.js",
      balance: 100000.0,
      aurBalance: 0.0,
      balanceChange: 0.0,
      skillPoints: 50000,
      shipTypeID: 606,
      shipName: "Velator",
      bounty: 0.0,
      skillQueueEndTime: 0,
      daysLeft: 365,
      userType: 30,
      paperDollState: 0,
      petitionMessage: "",
      worldSpaceID: 0,
      unreadMailCount: 0,
      upcomingEventCount: 0,
      unprocessedNotifications: 0,
      shipID: newCharId + 100,
      shortName: "none",
      allianceMemberStartDate: 0,
      skillTypeID: null,
      toLevel: null,
      trainingStartTime: null,
      trainingEndTime: null,
      queueEndTime: null,
      finishSP: null,
      trainedSP: null,
      finishedSkills: [],
    };

    const newCharacterRecord = characters[String(newCharId)];
    const writeResult = database.write(
      "characters",
      `/${String(newCharId)}`,
      newCharacterRecord,
    );

    if (!writeResult || !writeResult.success) {
      log.warn(
        `[CharService] Failed to persist new character ${newCharId}: ${writeResult ? writeResult.errorMsg : "WRITE_ERROR"}`,
      );
      return 0;
    }

    // Immediately re-read so follow-up SelectCharacterID sees the persisted row.
    const verifyResult = database.read("characters", `/${String(newCharId)}`);
    if (!verifyResult.success || !verifyResult.data) {
      log.warn(
        `[CharService] Newly created character ${newCharId} not visible after write; retrying full-table sync`,
      );
      const refreshResult = database.read("characters", "/");
      const refreshedCharacters =
        refreshResult.success &&
        refreshResult.data &&
        typeof refreshResult.data === "object"
          ? refreshResult.data
          : {};
      refreshedCharacters[String(newCharId)] = newCharacterRecord;
      database.write("characters", "/", refreshedCharacters);
    }

    if (session) {
      session.lastCreatedCharacterID = newCharId;
    }

    const inventoryResult = ensureCharacterInventory(newCharId);
    if (!inventoryResult || !inventoryResult.success) {
      log.warn(
        `[CharService] Failed to provision inventory for new character ${newCharId}: ${inventoryResult ? inventoryResult.errorMsg : "INVENTORY_ERROR"}`,
      );
    }

    ensureCharacterSkills(newCharId);

    log.success(
      `[CharService] Created character "${characterName}" with ID ${newCharId}`,
    );

    return newCharId;
  }

  Handle_GetCohortsForUser(args, session) {
    log.debug("[CharService] GetCohortsForUser");
    return { type: "list", items: [] };
  }

  Handle_GetTopBounties(args, session) {
    log.debug("[CharService] GetTopBounties");
    return { type: "list", items: [] };
  }

  Handle_GetCharCreationInfo(args, session) {
    log.debug("[CharService] GetCharCreationInfo");
    return { type: "dict", entries: [] };
  }

  Handle_GetCharNewExtraCreationInfo(args, session) {
    log.debug("[CharService] GetCharNewExtraCreationInfo");
    return { type: "dict", entries: [] };
  }

  Handle_IsUserReceivingCharacter(args, session) {
    log.debug("[CharService] IsUserReceivingCharacter");
    return false;
  }

  Handle_GetCharacterInfo(args, session) {
    log.debug("[CharService] GetCharacterInfo");
    return this.Handle_GetCharacterToSelect(args, session);
  }

  Handle_GetCharOmegaDowngradeStatus(args, session, kwargs) {
    log.debug("[CharService] GetCharOmegaDowngradeStatus");
    return null;
  }

  Handle_SelectCharacterID(args, session, kwargs) {
    const charId = resolveCharacterIdForSelection(args, kwargs, session);
    log.info(`[CharService] SelectCharacterID(${charId})`);

    if (!session) {
      return null;
    }

    const inventoryResult = ensureCharacterInventory(charId);
    if (!inventoryResult || !inventoryResult.success) {
      log.warn(
        `[CharService] Failed to ensure inventory for character ${charId}: ${inventoryResult ? inventoryResult.errorMsg : "INVENTORY_ERROR"}`,
      );
    }

    const previousPresence = snapshotSessionPresence(session);
    const applyResult = applyCharacterToSession(session, charId, {
      emitNotifications: true,
      logSelection: true,
    });

    if (!applyResult.success) {
      log.warn(
        `[CharService] Failed to select character ${charId}: ${applyResult.errorMsg}`,
      );
      return null;
    } else if (!session.stationid && !session.stationID) {
      restoreSpaceSession(session);
    }

    const selectedCharacterId = normalizeRpcInt(
      session.characterID || charId,
      charId,
    );
    session.selectedCharacterID = selectedCharacterId;

    const onlineResult = setCharacterOnlineState(selectedCharacterId, true, {
      stationID: session.stationid || session.stationID || null,
    });
    if (!onlineResult.success) {
      log.warn(
        `[CharService] Failed to mark character ${selectedCharacterId} online: ${onlineResult.errorMsg}`,
      );
    }

    const currentPresence = snapshotSessionPresence(session);
    const shouldBroadcastJoin =
      currentPresence &&
      (!previousPresence ||
        currentPresence.characterID !== previousPresence.characterID ||
        currentPresence.stationID !== previousPresence.stationID);
    if (shouldBroadcastJoin) {
      broadcastStationGuestEvent("OnCharNowInStation", currentPresence, {
        excludeSession: session,
      });
    }
    return null;
  }

  Handle_ValidateNameEx(args, session) {
    log.debug("[CharService] ValidateNameEx");
    return true;
  }

  Handle_GetCharacterLockType(args, session) {
    log.debug("[CharService] GetCharacterLockType");
    return null;
  }
}

module.exports = CharService;
