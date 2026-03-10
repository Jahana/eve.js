/**
 * Corporation Service (corporationSvc)
 *
 * Handles corporation-related queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));
const {
  buildFiletimeLong,
  buildKeyVal,
  buildList,
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

function buildCorporationInfo(session, charData) {
  const corpId =
    charData.corporationID ||
    (session ? session.corporationID || session.corpid : 1000044);
  const allianceId =
    charData.allianceID || (session ? session.allianceID || session.allianceid : null);
  const ceoID =
    (session && (session.characterID || session.charid)) || null;
  const row = [corpId, "Your Corp Name", "TICKR", ceoID, 1];

  return buildKeyVal([
    ["corporationID", corpId],
    ["corporationName", "Your Corp Name"],
    ["ticker", "TICKR"],
    ["allianceID", allianceId],
    ["ceoID", ceoID],
    ["membership", 1],
    ["header", ["corporationID", "corporationName", "ticker", "ceoID", "membership"]],
    ["row", row],
    ["line", row],
    ["memberCount", 1],
    ["taxRate", 0.0],
    ["description", "A custom corporation."],
    ["url", "http://localhost"],
  ]);
}

class CorpService extends BaseService {
  constructor() {
    super("corporationSvc");
  }

  Handle_GetMyCorporationInfo(args, session) {
    log.debug("[CorpSvc] GetMyCorporationInfo");
    const { charData } = resolveCharacterInfo(args, session);
    return buildCorporationInfo(session, charData);
  }

  Handle_GetNPCDivisions() {
    log.debug("[CorpSvc] GetNPCDivisions");
    return { type: "list", items: [] };
  }

  Handle_GetEmploymentRecord(args, session) {
    log.debug("[CorpSvc] GetEmploymentRecord");
    const { charData } = resolveCharacterInfo(args, session);
    return buildRowset(
      ["corporationID", "startDate", "deleted"],
      [
        buildList([
          charData.corporationID || (session ? session.corporationID : 1000044),
          buildFiletimeLong(charData.startDateTime || charData.createDateTime),
          0,
        ]),
      ],
    );
  }

  Handle_GetRecruitmentAdsByCriteria() {
    log.debug("[CorpSvc] GetRecruitmentAdsByCriteria");
    return { type: "list", items: [] };
  }

  Handle_GetInfoWindowDataForChar(args, session) {
    log.debug("[CorpSvc] GetInfoWindowDataForChar");
    const { charData } = resolveCharacterInfo(args, session);
    return buildKeyVal([
      ["corpID", charData.corporationID || (session ? session.corporationID : 1000044)],
      ["allianceID", charData.allianceID || (session ? session.allianceID : null)],
      ["title", charData.title || ""],
    ]);
  }
}

module.exports = CorpService;
