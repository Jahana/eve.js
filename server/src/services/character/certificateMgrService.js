const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildList,
  buildRowset,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function buildMyCertificatesRowset() {
  return buildRowset(["certificateID", "grantDate", "visibilityFlags"], []);
}

function buildCharacterCertificatesRowset() {
  return buildRowset(["grantDate", "certificateID", "visibilityFlags"], []);
}

class CertificateMgrService extends BaseService {
  constructor() {
    super("certificateMgr");
  }

  Handle_GetMyCertificates() {
    log.debug("[CertificateMgr] GetMyCertificates");
    return buildMyCertificatesRowset();
  }

  Handle_GetCertificateCategories() {
    log.debug("[CertificateMgr] GetCertificateCategories");
    return buildList([]);
  }

  Handle_GetAllShipCertificateRecommendations() {
    log.debug("[CertificateMgr] GetAllShipCertificateRecommendations");
    return { type: "dict", entries: [] };
  }

  Handle_GetCertificateClasses() {
    log.debug("[CertificateMgr] GetCertificateClasses");
    return buildList([]);
  }

  Handle_GrantCertificate(args) {
    log.debug(
      `[CertificateMgr] GrantCertificate(${normalizeNumber(args && args[0], 0)})`,
    );
    return null;
  }

  Handle_UpdateCertificateFlags(args) {
    log.debug(
      `[CertificateMgr] UpdateCertificateFlags(${normalizeNumber(args && args[0], 0)})`,
    );
    return null;
  }

  Handle_BatchCertificateGrant() {
    log.debug("[CertificateMgr] BatchCertificateGrant");
    return buildList([]);
  }

  Handle_BatchCertificateUpdate() {
    log.debug("[CertificateMgr] BatchCertificateUpdate");
    return null;
  }

  Handle_GetCertificatesByCharacter() {
    log.debug("[CertificateMgr] GetCertificatesByCharacter");
    return buildCharacterCertificatesRowset();
  }
}

module.exports = CertificateMgrService;
