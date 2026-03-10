const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { buildDict, buildKeyVal } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const { getCharacterFittings } = require(path.join(__dirname, "./fittingState"));

class CharFittingMgrService extends BaseService {
  constructor() {
    super("charFittingMgr");
  }

  Handle_GetFittings(args, session) {
    const ownerID =
      args && args.length > 0 ? args[0] : session && session.characterID;
    log.debug(`[CharFittingMgr] GetFittings(${ownerID})`);
    const fittings = getCharacterFittings(ownerID);
    return buildDict(
      Object.entries(fittings).map(([fittingID, fitting]) => [
        Number(fittingID),
        buildKeyVal(Object.entries(fitting)),
      ]),
    );
  }

  Handle_SaveFitting() {
    log.debug("[CharFittingMgr] SaveFitting");
    return null;
  }

  Handle_SaveManyFittings() {
    log.debug("[CharFittingMgr] SaveManyFittings");
    return null;
  }

  Handle_DeleteFitting() {
    log.debug("[CharFittingMgr] DeleteFitting");
    return null;
  }

  Handle_UpdateNameAndDescription() {
    log.debug("[CharFittingMgr] UpdateNameAndDescription");
    return null;
  }
}

module.exports = CharFittingMgrService;
