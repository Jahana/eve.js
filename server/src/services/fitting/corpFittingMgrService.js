const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildDict } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

class CorpFittingMgrService extends BaseService {
  constructor() {
    super("corpFittingMgr");
  }

  Handle_GetFittings(args) {
    const ownerID = args && args.length > 0 ? args[0] : 0;
    log.debug(`[CorpFittingMgr] GetFittings(${ownerID})`);
    return buildDict([]);
  }

  Handle_SaveFitting() {
    log.debug("[CorpFittingMgr] SaveFitting");
    return null;
  }

  Handle_SaveManyFittings() {
    log.debug("[CorpFittingMgr] SaveManyFittings");
    return null;
  }

  Handle_DeleteFitting() {
    log.debug("[CorpFittingMgr] DeleteFitting");
    return null;
  }

  Handle_UpdateNameAndDescription() {
    log.debug("[CorpFittingMgr] UpdateNameAndDescription");
    return null;
  }
}

module.exports = CorpFittingMgrService;
