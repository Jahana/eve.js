const BaseService = require("../baseService");
const log = require("../../utils/logger");

class SkillHandlerService extends BaseService {
  constructor() {
    super("skillHandler");
  }

  _buildSkillQueue() {
    return { type: "list", items: [] };
  }

  Handle_GetSkillQueueAndFreePoints(args, session) {
    log.debug("[SkillHandler] GetSkillQueueAndFreePoints");

    return [
      this._buildSkillQueue(),
      0, // free skill points
    ];
  }

  Handle_GetSkillQueue(args, session) {
    log.debug("[SkillHandler] GetSkillQueue");
    return this._buildSkillQueue();
  }

  Handle_GetFreeSkillPoints(args, session) {
    log.debug("[SkillHandler] GetFreeSkillPoints");
    return 0;
  }
}

module.exports = SkillHandlerService;
