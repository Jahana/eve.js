/**
 * Character Manager Service (charMgr)
 *
 * Handles character info queries post-selection.
 * Different from charUnboundMgr — this is bound to a specific character.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  getCharacterRecord,
  resolveHomeStationInfo,
} = require(path.join(__dirname, "./characterState"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildRow,
  buildRowset,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function resolveCharacterInfo(args, session) {
  const charId =
    args && args.length > 0 ? args[0] : session ? session.characterID : 0;

  return {
    charId,
    charData: getCharacterRecord(charId) || {},
  };
}

function resolveHomeStationRecord(charData, session) {
  const homeStationInfo = resolveHomeStationInfo(charData, session);

  return {
    station: getStationRecord(session, homeStationInfo.homeStationID),
    homeStationInfo,
  };
}

function buildHomeStationPayload(station, homeStationInfo = {}) {
  return buildKeyVal([
    ["id", station.stationID],
    ["station_id", station.stationID],
    ["stationID", station.stationID],
    ["home_station_id", station.stationID],
    ["type_id", station.stationTypeID],
    ["typeID", station.stationTypeID],
    ["station_type_id", station.stationTypeID],
    ["name", station.stationName],
    ["station_name", station.stationName],
    ["stationName", station.stationName],
    ["solar_system_id", station.solarSystemID],
    ["solarSystemID", station.solarSystemID],
    ["constellation_id", station.constellationID],
    ["constellationID", station.constellationID],
    ["region_id", station.regionID],
    ["regionID", station.regionID],
    ["owner_id", station.ownerID],
    ["ownerID", station.ownerID],
    ["clone_station_id", homeStationInfo.cloneStationID || station.stationID],
    ["cloneStationID", homeStationInfo.cloneStationID || station.stationID],
    ["is_fallback", Boolean(homeStationInfo.isFallback)],
    ["isFallback", Boolean(homeStationInfo.isFallback)],
    ["stationTypeID", station.stationTypeID],
  ]);
}

class CharMgrService extends BaseService {
  constructor() {
    super("charMgr");
  }

  Handle_GetPublicInfo(args, session) {
    const { charId, charData } = resolveCharacterInfo(args, session);
    log.info(`[CharMgr] GetPublicInfo(${charId})`);
    const factionID = charData.factionID ?? null;
    const empireID = charData.empireID ?? factionID;

    return buildKeyVal([
      ["characterID", charId],
      [
        "characterName",
        charData.characterName || (session ? session.characterName : "Unknown"),
      ],
      ["typeID", charData.typeID || 1373],
      ["raceID", charData.raceID || 1],
      ["bloodlineID", charData.bloodlineID || 1],
      ["ancestryID", charData.ancestryID || 1],
      [
        "corporationID",
        charData.corporationID || (session ? session.corporationID : 1000009),
      ],
      ["allianceID", charData.allianceID || (session ? session.allianceID : null)],
      ["factionID", factionID],
      ["empireID", empireID],
      ["schoolID", charData.schoolID ?? charData.corporationID ?? null],
      ["gender", charData.gender || 1],
      ["createDateTime", buildFiletimeLong(charData.createDateTime)],
      ["description", charData.description || ""],
      ["securityRating", Number(charData.securityStatus ?? charData.securityRating ?? 0)],
      ["securityStatus", Number(charData.securityStatus ?? charData.securityRating ?? 0)],
      ["bounty", Number(charData.bounty || 0)],
      ["title", charData.title || ""],
      [
        "stationID",
        charData.stationID ?? (session ? (session.stationID ?? session.stationid ?? null) : null),
      ],
      ["solarSystemID", charData.solarSystemID || (session ? session.solarsystemid2 : 30000142)],
    ]);
  }

  Handle_GetPublicInfo3(args, session) {
    log.debug("[CharMgr] GetPublicInfo3");
    return this.Handle_GetPublicInfo(args, session);
  }

  Handle_GetTopBounties() {
    log.debug("[CharMgr] GetTopBounties");
    return { type: "list", items: [] };
  }

  Handle_GetPrivateInfo(args, session) {
    log.debug("[CharMgr] GetPrivateInfo");
    const { charId, charData } = resolveCharacterInfo(args, session);
    return buildRow(
      [
        "characterID",
        "gender",
        "createDateTime",
        "raceID",
        "bloodlineID",
        "ancestryID",
        "balance",
        "securityRating",
      ],
      [
        charId,
        charData.gender || 1,
        buildFiletimeLong(charData.createDateTime),
        charData.raceID || 1,
        charData.bloodlineID || 1,
        charData.ancestryID || 1,
        Number(charData.balance ?? 0),
        Number(charData.securityStatus ?? charData.securityRating ?? 0),
      ],
    );
  }

  Handle_GetCharacterDescription(args, session) {
    const { charData } = resolveCharacterInfo(args, session);
    log.debug("[CharMgr] GetCharacterDescription");
    return charData.description || "";
  }

  Handle_GetCloneInfo(args, session) {
    log.debug("[CharMgr] GetCloneInfo");
    const { charData } = resolveCharacterInfo(args, session);
    const { station, homeStationInfo } = resolveHomeStationRecord(charData, session);

    return buildKeyVal([
      ["homeStationID", station.stationID],
      [
        "cloneStationID",
        Number(homeStationInfo.cloneStationID || station.stationID) || station.stationID,
      ],
      ["clones", buildDict([])],
      ["implants", buildDict([])],
      ["timeLastJump", buildFiletimeLong(0n)],
    ]);
  }

  Handle_GetHomeStation(args, session) {
    log.debug("[CharMgr] GetHomeStation");
    const { charData } = resolveCharacterInfo(args, session);
    const { station, homeStationInfo } = resolveHomeStationRecord(charData, session);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_LogStartOfCharacterCreation() {
    log.debug("[CharMgr] LogStartOfCharacterCreation");
    return null;
  }

  // EVEmu PDState: 0=NoRecustomization (finalized), 1=Resculpting,
  // 2=NoExistingCustomization, 3=FullRecustomizing, 4=ForceRecustomize
  Handle_GetPaperdollState() {
    log.debug("[CharMgr] GetPaperdollState -> 0 (NoRecustomization)");
    return 0;
  }

  Handle_GetCharacterSettings() {
    log.debug("[CharMgr] GetCharacterSettings called");
    return buildKeyVal([
      ["public", buildDict([])],
      ["private", buildDict([])],
      ["ui", buildDict([])],
    ]);
  }

  Handle_GetSettingsInfo() {
    log.debug("[CharMgr] GetSettingsInfo called");
    const py2codeHex =
      "630000000000000000010000004300000073040000006900005328010000004e280000000028000000002800000000280000000073080000003c737472696e673e740100000066010000007300000000";
    return [Buffer.from(py2codeHex, "hex"), 0];
  }

  Handle_GetContactList() {
    log.debug("[CharMgr] GetContactList called");
    return buildKeyVal([
      [
        "addresses",
        buildRowset(
          ["contactID", "inWatchlist", "relationshipID", "labelMask"],
          [],
          "eve.common.script.sys.rowset.Rowset",
        ),
      ],
      [
        "blocked",
        buildRowset(
          ["contactID", "inWatchlist", "relationshipID", "labelMask"],
          [],
          "eve.common.script.sys.rowset.Rowset",
        ),
      ],
    ]);
  }
}

module.exports = CharMgrService;
