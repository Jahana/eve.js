const path = require("path");
const BaseService = require("../baseService");
const log = require("../../utils/logger");

class AccessGroupBookmarkMgrService extends BaseService {
  constructor() {
    super("accessGroupBookmarkMgr");
  }

  Handle_GetMyActiveBookmarks(args, session) {
    log.debug("[AccessGroupBookmarkMgr] GetMyActiveBookmarks called");
    return [
      { type: "list", items: [] },
      { type: "list", items: [] },
      { type: "list", items: [] },
    ];
  }

  Handle_AddFolder(args, session) {
    log.debug("[AccessGroupBookmarkMgr] AddFolder called");
    return null;
  }
}

module.exports = AccessGroupBookmarkMgrService;
