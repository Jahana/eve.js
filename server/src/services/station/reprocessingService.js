const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildBoundObjectResponse,
  extractDictEntries,
  extractList,
  normalizeNumber,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function buildQuote(itemId) {
  return buildKeyVal([
    ["itemID", itemId],
    ["leftOvers", 0],
    ["quantityToProcess", 0],
    ["playerStanding", 0.0],
    ["lines", buildList([])],
  ]);
}

function extractTypeIds(rawValue) {
  return extractDictEntries(rawValue)
    .map((entry) => normalizeNumber(entry[0], 0))
    .filter((value) => value > 0);
}

class ReprocessingService extends BaseService {
  constructor() {
    super("reprocessingSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[ReprocessingSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[ReprocessingSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetOptionsForItemTypes(args) {
    log.debug("[ReprocessingSvc] GetOptionsForItemTypes");
    const typeIds = extractTypeIds(args && args[0]);
    return buildDict(
      typeIds.map((typeId) => [
        typeId,
        buildKeyVal([
          ["isRecyclable", false],
          ["isRefinable", false],
        ]),
      ]),
    );
  }

  Handle_GetReprocessingInfo() {
    log.debug("[ReprocessingSvc] GetReprocessingInfo");
    return buildKeyVal([
      ["standing", 0.0],
      ["tax", 0.05],
      ["yield", 0.5],
      ["combinedyield", 0.5],
    ]);
  }

  Handle_GetQuote(args) {
    log.debug("[ReprocessingSvc] GetQuote");
    return buildQuote(normalizeNumber(args && args[0], 0));
  }

  Handle_GetQuotes(args) {
    log.debug("[ReprocessingSvc] GetQuotes");
    const itemIds = extractList(args && args[0]);
    return buildDict(
      itemIds.map((itemId) => [normalizeNumber(itemId, 0), buildQuote(itemId)]),
    );
  }

  Handle_Reprocess() {
    log.debug("[ReprocessingSvc] Reprocess");
    return null;
  }
}

module.exports = ReprocessingService;
