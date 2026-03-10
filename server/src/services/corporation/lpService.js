const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildList,
  buildBoundObjectResponse,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

class LPService extends BaseService {
  constructor() {
    super("LPSvc");
  }

  Handle_MachoResolveObject() {
    log.debug("[LPSvc] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[LPSvc] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetLPExchangeRates() {
    log.debug("[LPSvc] GetLPExchangeRates");
    return buildList([]);
  }

  Handle_GetLPsForCharacter() {
    log.debug("[LPSvc] GetLPsForCharacter");
    return buildList([]);
  }

  Handle_GetLPForCharacterCorp() {
    log.debug("[LPSvc] GetLPForCharacterCorp");
    return 0;
  }

  Handle_GetAvailableOffersFromCorp() {
    log.debug("[LPSvc] GetAvailableOffersFromCorp");
    return buildList([]);
  }

  Handle_TakeOffer() {
    log.debug("[LPSvc] TakeOffer");
    return null;
  }

  Handle_ExchangeConcordLP() {
    log.debug("[LPSvc] ExchangeConcordLP");
    return buildDict([]);
  }
}

module.exports = LPService;
