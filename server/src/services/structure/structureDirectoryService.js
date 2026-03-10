const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

class StructureDirectoryService extends BaseService {
  constructor() {
    super("structureDirectory");
  }

  callMethod(method, args, session, kwargs) {
    const handlerName = `Handle_${method}`;
    if (
      typeof this[handlerName] === "function" ||
      typeof this[method] === "function"
    ) {
      return super.callMethod(method, args, session, kwargs);
    }

    // The modern client probes several structure-directory reads while
    // building station/system UI. Returning null here bubbles into
    // client-side `structures = None` errors in map/surroundings code.
    if (typeof method === "string" && method.startsWith("Get")) {
      log.debug(
        `[StructureDirectoryService] Fallback empty result for ${method}`,
      );
      return { type: "list", items: [] };
    }

    return super.callMethod(method, args, session, kwargs);
  }

  Handle_GetMyDockableStructures(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetMyDockableStructures called");
    return { type: "list", items: [] };
  }

  Handle_GetStructures(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetStructures called");
    return { type: "list", items: [] };
  }

  Handle_GetStructuresInSystem(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetStructuresInSystem called");
    return { type: "list", items: [] };
  }

  Handle_GetSolarsystemStructures(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetSolarsystemStructures called");
    return { type: "list", items: [] };
  }

  Handle_GetStructureMapData(args, session, kwargs) {
    log.debug("[StructureDirectoryService] GetStructureMapData called");
    return { type: "list", items: [] };
  }
}

module.exports = StructureDirectoryService;
