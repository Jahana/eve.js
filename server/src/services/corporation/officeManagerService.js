const BaseService = require("../baseService");
const log = require("../../utils/logger");
const path = require("path");
const { buildRowset } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));

class OfficeManagerService extends BaseService {
  constructor() {
    super("officeManager");
  }

  Handle_GetMyCorporationsOffices(args, session) {
    log.debug("[OfficeManager] GetMyCorporationsOffices called");
    return buildRowset(
      ["stationID", "officeFolderID", "itemID"],
      [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }
}

module.exports = OfficeManagerService;
