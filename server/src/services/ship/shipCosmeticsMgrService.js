const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class ShipCosmeticsMgrService extends BaseService {
  constructor() {
    super("shipCosmeticsMgr");
  }

  Handle_GetEnabledCosmetics(args, session) {
    log.debug("[ShipCosmeticsMgr] GetEnabledCosmetics called");
    return { type: "dict", entries: [] };
  }
}

module.exports = ShipCosmeticsMgrService;
