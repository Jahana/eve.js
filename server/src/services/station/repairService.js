const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildBoundObjectResponse,
  extractList,
  normalizeNumber,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function buildDamageReport() {
  return buildKeyVal([
    ["discount", "0%"],
    ["serviceCharge", "0%"],
    ["playerStanding", 0.0],
    ["lines", buildList([])],
  ]);
}

class RepairService extends BaseService {
  constructor() {
    super("repairSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[RepairSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[RepairSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetDamageReports(args) {
    log.debug("[RepairSvc] GetDamageReports");
    const itemIds = extractList(args && args[0]);
    return buildDict(
      itemIds.map((itemId) => [normalizeNumber(itemId, 0), buildDamageReport()]),
    );
  }

  Handle_DamageModules() {
    log.debug("[RepairSvc] DamageModules");
    return null;
  }

  Handle_RepairItems() {
    log.debug("[RepairSvc] RepairItems");
    return null;
  }

  Handle_UnasembleItems() {
    log.debug("[RepairSvc] UnasembleItems");
    return null;
  }
}

module.exports = RepairService;
