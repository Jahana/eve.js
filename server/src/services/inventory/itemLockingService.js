const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class ItemLockingService extends BaseService {
  constructor() {
    super("itemLocking");
  }

  _emptyList() {
    return { type: "list", items: [] };
  }

  Handle_GetItemsByLocation(args, session, kwargs) {
    log.debug(
      `[ItemLocking] GetItemsByLocation args=${JSON.stringify(
        args || [],
        (k, v) => (typeof v === "bigint" ? v.toString() : v),
      )}`,
    );
    return this._emptyList();
  }

  Handle_GetLockedItemsByLocation(args, session, kwargs) {
    return this._emptyList();
  }

  Handle_GetLockedItems(args, session, kwargs) {
    return this._emptyList();
  }

  Handle_GetLockedItemLocations(args, session, kwargs) {
    return this._emptyList();
  }

  Handle_IsItemLocked(args, session, kwargs) {
    return false;
  }

  Handle_LockItem(args, session, kwargs) {
    return null;
  }

  Handle_UnlockItem(args, session, kwargs) {
    return null;
  }

  Handle_LockItems(args, session, kwargs) {
    return null;
  }

  Handle_UnlockItems(args, session, kwargs) {
    return null;
  }
}

module.exports = ItemLockingService;
