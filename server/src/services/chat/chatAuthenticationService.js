const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class ChatAuthenticationService extends BaseService {
  constructor() {
    super("chatAuthenticationService");
  }

  Handle_GetAuthenticationToken(args, session) {
    const charId = Number(
      session ? session.characterID || session.charid || 0 : 0,
    );
    log.debug(
      `[ChatAuthenticationService] GetAuthenticationToken(charID=${charId || 0})`,
    );
    // The client accepts this static dev token and continues XMPP auth flow.
    return "ejabberd";
  }
}

module.exports = ChatAuthenticationService;
