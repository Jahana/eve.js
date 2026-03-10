/**
 * Bookmark Manager Service (bookmarkMgr)
 *
 * Handles bookmark queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class BookmarkService extends BaseService {
  constructor() {
    super("bookmarkMgr");
  }

  Handle_GetBookmarks(args, session) {
    log.debug("[BookmarkMgr] GetBookmarks");
    return [
      { type: "list", items: [] },
      { type: "list", items: [] },
    ];
  }

  Handle_CreateFolder(args, session) {
    log.debug("[BookmarkMgr] CreateFolder");
    return null;
  }

  Handle_GetFolders(args, session) {
    log.debug("[BookmarkMgr] GetFolders");
    return {
      type: "list",
      items: [],
    };
  }

  Handle_GetBookmarksInFolder(args, session) {
    const folderID = args && args.length > 0 ? args[0] : 0;
    log.debug(`[BookmarkMgr] GetBookmarksInFolder(${folderID})`);
    return {
      type: "list",
      items: [],
    };
  }
}

module.exports = BookmarkService;
