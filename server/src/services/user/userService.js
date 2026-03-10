/**
 * User Service — "userSvc"
 *
 * Handles account-level queries such as redeem tokens and reporting bots.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { performCharacterLogoff } = require(path.join(
  __dirname,
  "./logoffCharacter",
));

class UserService extends BaseService {
  constructor() {
    super("userSvc");
  }

  /**
   * GetRedeemTokens — returns tokens available to redeem
   *
   * Called during login process. If no tokens are available,
   * it returns an empty list. EVEmu does: `return new PyList();`
   */
  Handle_GetRedeemTokens(args, session, kwargs) {
    log.debug("[UserService] GetRedeemTokens called");
    // Return empty PyList
    return {
      type: "list",
      items: [],
    };
  }

  Handle_GetMultiCharactersTrainingSlots(args, session) {
    log.debug("[userSvc] GetMultiCharactersTrainingSlots called");
    return {
      type: "dict",
      entries: [],
    };
  }

  /**
   * UserLogOffCharacter
   *
   * Triggered by the in-client "Log off" action.
   * Keep the TCP session alive so the client can return to character selection.
   */
  Handle_UserLogOffCharacter(args, session) {
    log.info("[userSvc] UserLogOffCharacter called");
    return performCharacterLogoff(session, "userSvc");
  }

  // Compatibility alias used by some clients/builds.
  Handle_LogOffCharacter(args, session) {
    return this.Handle_UserLogOffCharacter(args, session);
  }
}

module.exports = UserService;
