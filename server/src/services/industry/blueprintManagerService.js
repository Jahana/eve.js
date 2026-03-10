const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const log = require(path.join(__dirname, "../../utils/logger"));

class BlueprintManagerService extends BaseService {
  constructor() {
    super("blueprintManager");
  }

  Handle_GetLimits() {
    log.debug("[BlueprintManager] GetLimits");
    return buildDict([
      ["maxBlueprintResults", 500],
    ]);
  }

  Handle_GetBlueprintData(args) {
    const blueprintID = args && args.length > 0 ? args[0] : null;
    log.warn(
      `[BlueprintManager] GetBlueprintData(${String(blueprintID)}) is not implemented yet`,
    );
    return buildDict([]);
  }

  Handle_GetBlueprintDataByOwner(args) {
    const ownerID = args && args.length > 0 ? args[0] : null;
    const facilityID = args && args.length > 1 ? args[1] : null;
    log.debug(
      `[BlueprintManager] GetBlueprintDataByOwner(ownerID=${String(ownerID)}, facilityID=${String(facilityID)})`,
    );
    return [
      buildList([]),
      buildDict([]),
    ];
  }
}

module.exports = BlueprintManagerService;
