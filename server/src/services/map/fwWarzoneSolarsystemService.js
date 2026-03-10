const BaseService = require("../baseService");
const log = require("../../utils/logger");

class FwWarzoneSolarsystemService extends BaseService {
  constructor() {
    super("fwWarzoneSolarsystem");
  }

  Handle_GetLocalOccupationState(args, session) {
    log.debug("[fwWarzoneSvc] GetLocalOccupationState called");
    const solarSystemID =
      Number(
        args && args.length > 0
          ? args[0]
          : session && (session.solarsystemid2 || session.solarsystemid),
      ) || 0;

    // V23.02 expects a 2-tuple of:
    //   (solarSystemID, occupationState)
    // For non-warzone systems, the second slot must be None. Returning a
    // populated util.KeyVal here makes the client treat the current system as
    // faction warfare even when owner/occupier are null.
    return [solarSystemID, null];
  }
}

module.exports = FwWarzoneSolarsystemService;
