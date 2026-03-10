const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class BountyProxyService extends BaseService {
  constructor() {
    super("bountyProxy");
  }

  Handle_GetMyKillRights(args, session) {
    const charId = Number(
      session ? session.characterID || session.charid || 0 : 0,
    );
    log.debug(`[BountyProxy] GetMyKillRights(charID=${charId || 0})`);
    // Return empty map: no active kill rights.
    return { type: "dict", entries: [] };
  }
}

module.exports = BountyProxyService;
