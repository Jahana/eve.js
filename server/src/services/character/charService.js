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
const { applyCharacterToSession } = require("./characterState");

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
    for (const [charId, character] of Object.entries(characters)) {
      if (character.accountId === userId) {
        const cid = parseInt(charId, 10);
        characterDetails.push(
          buildKeyVal([
            ["characterID", cid],
            ["characterName", character.characterName || "Unknown"],
            ["deletePrepareDateTime", null],
            ["gender", character.gender || 1],
            ["typeID", character.typeID || 1373],
            ["bloodlineID", character.bloodlineID || 1],
            ["corporationID", character.corporationID || 1000009],
            ["allianceID", character.allianceID || 0],
            ["factionID", null],
            ["stationID", character.stationID || 60003760],
            ["solarSystemID", character.solarSystemID || 30000142],
            ["constellationID", character.constellationID || 20000020],
            ["regionID", character.regionID || 10000002],
            ["balance", character.balance || 100000.0],
            ["balanceChange", 0.0],
            ["skillPoints", character.skillPoints || 50000],
            ["shipTypeID", character.shipTypeID || 606],
            ["shipName", character.shipName || "Velator"],
            ["securityRating", character.securityRating || 0.0],
            ["title", character.title || ""],
            ["unreadMailCount", character.unreadMailCount || 0],
            ["paperdollState", character.paperDollState || 0],
            ["lockTypeID", null],
            [
              "logoffDate",
              { type: "long", value: character.logoffDate || 132000000000000000 },
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
      const entry = kwargs.entries.find((candidate) => candidate[0] === "characterID");
      if (entry) {
        charId = entry[1];
      }
    }
    log.info(`[CharService] GetCharacterToSelect(${charId})`);

    const characterResult = database.read("characters", "/");
    const characters = characterResult.success ? characterResult.data : {};
    const character = characters[String(charId)];

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
      ["stationID", character.stationID || 60003760],
      ["solarSystemID", character.solarSystemID || 30000142],
      ["constellationID", character.constellationID || 20000020],
      ["regionID", character.regionID || 10000002],
      ["allianceID", character.allianceID || 0],
      ["allianceMemberStartDate", character.allianceMemberStartDate || 0],
      ["shortName", character.shortName || "none"],
      ["bounty", character.bounty || 0.0],
      ["skillQueueEndTime", { type: "long", value: character.skillQueueEndTime || 0 }],
      ["skillPoints", character.skillPoints || 50000],
      ["shipTypeID", character.shipTypeID || 606],
      ["shipName", character.shipName || "Ship"],
      ["securityRating", character.securityRating || 0.0],
      ["title", character.title || ""],
      ["balance", character.balance || 100000.0],
      ["aurBalance", character.aurBalance || 0.0],
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

    database.write(
      "characters",
      `/${String(newCharId)}`,
      characters[String(newCharId)],
    );

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
    return null;
  }

  Handle_GetCharOmegaDowngradeStatus(args, session, kwargs) {
    log.debug("[CharService] GetCharOmegaDowngradeStatus");
    return null;
  }

  Handle_SelectCharacterID(args, session, kwargs) {
    let charId = args && args.length > 0 ? args[0] : 0;
    if (charId === 0 && kwargs && kwargs.entries) {
      const entry = kwargs.entries.find((candidate) => candidate[0] === "characterID");
      if (entry) {
        charId = entry[1];
      }
    }
    log.info(`[CharService] SelectCharacterID(${charId})`);

    if (!session) {
      return null;
    }

    const applyResult = applyCharacterToSession(session, charId, {
      emitNotifications: true,
      logSelection: true,
    });

    if (!applyResult.success) {
      log.warn(
        `[CharService] Failed to select character ${charId}: ${applyResult.errorMsg}`,
      );
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
