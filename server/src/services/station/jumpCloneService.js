const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildFiletimeLong,
  buildKeyVal,
  buildList,
  buildBoundObjectResponse,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function buildCloneState() {
  return buildKeyVal([
    ["clones", buildDict([])],
    ["implants", buildDict([])],
    ["timeLastJump", buildFiletimeLong(0n)],
  ]);
}

class JumpCloneService extends BaseService {
  constructor() {
    super("jumpCloneSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[JumpCloneSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[JumpCloneSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetCloneState() {
    log.debug("[JumpCloneSvc] GetCloneState");
    return buildCloneState();
  }

  Handle_GetShipCloneState() {
    log.debug("[JumpCloneSvc] GetShipCloneState");
    return buildList([]);
  }

  Handle_GetPriceForClone() {
    log.debug("[JumpCloneSvc] GetPriceForClone");
    return 1000000;
  }

  Handle_InstallCloneInStation() {
    log.debug("[JumpCloneSvc] InstallCloneInStation");
    return null;
  }

  Handle_GetStationCloneState() {
    log.debug("[JumpCloneSvc] GetStationCloneState");
    return buildCloneState();
  }

  Handle_OfferShipCloneInstallation() {
    log.debug("[JumpCloneSvc] OfferShipCloneInstallation");
    return null;
  }

  Handle_DestroyInstalledClone() {
    log.debug("[JumpCloneSvc] DestroyInstalledClone");
    return null;
  }

  Handle_AcceptShipCloneInstallation() {
    log.debug("[JumpCloneSvc] AcceptShipCloneInstallation");
    return null;
  }

  Handle_CancelShipCloneInstallation() {
    log.debug("[JumpCloneSvc] CancelShipCloneInstallation");
    return null;
  }

  Handle_CloneJump() {
    log.debug("[JumpCloneSvc] CloneJump");
    return null;
  }
}

module.exports = JumpCloneService;
