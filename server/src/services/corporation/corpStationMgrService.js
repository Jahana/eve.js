const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildBoundObjectResponse,
  buildKeyVal,
  buildList,
  buildRowset,
  resolveBoundNodeId,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  getStationRecord,
  getStationServiceIdentifiers,
  getStationServiceStates,
  getStationServiceAccessRule,
  getStationManagementServiceCostModifiers,
  getRentableItems,
} = require(path.join(__dirname, "../_shared/stationStaticData"));

class CorpStationMgrService extends BaseService {
  constructor() {
    super("corpStationMgr");
  }

  Handle_MachoResolveObject() {
    log.debug("[CorpStationMgr] MachoResolveObject");
    return resolveBoundNodeId();
  }

  Handle_MachoBindObject(args, session, kwargs) {
    log.debug("[CorpStationMgr] MachoBindObject");
    return buildBoundObjectResponse(this, args, session, kwargs);
  }

  Handle_GetStationServiceStates(args, session) {
    log.debug("[CorpStationMgr] GetStationServiceStates");
    return {
      type: "dict",
      entries: getStationServiceStates(session).map((row) => [
        row.serviceID,
        buildKeyVal([
          ["solarSystemID", row.solarSystemID],
          ["stationID", row.stationID],
          ["serviceID", row.serviceID],
          ["stationServiceItemID", row.stationServiceItemID],
          ["isEnabled", row.isEnabled],
        ]),
      ]),
    };
  }

  Handle_GetImprovementStaticData() {
    log.debug("[CorpStationMgr] GetImprovementStaticData");
    return buildKeyVal([["improvementTypes", buildRowset([], [], "eve.common.script.sys.rowset.Rowset")]]);
  }

  Handle_GetStationServiceIdentifiers() {
    log.debug("[CorpStationMgr] GetStationServiceIdentifiers");
    return buildRowset(
      ["serviceID", "serviceName", "serviceNameID"],
      getStationServiceIdentifiers().map((service) =>
        buildList([
          service.serviceID,
          service.serviceName,
          service.serviceNameID,
        ]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetStationDetails(args, session) {
    const stationID = args && args.length > 0 ? args[0] : null;
    log.debug(`[CorpStationMgr] GetStationDetails(${stationID})`);
    const station = getStationRecord(session, stationID);
    return buildKeyVal([
      ["stationName", station.stationName],
      ["stationID", station.stationID],
      ["orbitID", station.orbitID],
      ["description", station.description],
      ["security", station.security],
      ["dockingCostPerVolume", station.dockingCostPerVolume],
      ["officeRentalCost", station.officeRentalCost],
      ["reprocessingStationsTake", station.reprocessingStationsTake],
      ["reprocessingHangarFlag", station.reprocessingHangarFlag],
      ["corporationID", station.corporationID],
      ["maxShipVolumeDockable", station.maxShipVolumeDockable],
      ["exitTime", null],
      ["standingOwnerID", station.ownerID],
      ["upgradeLevel", station.upgradeLevel],
    ]);
  }

  Handle_GetStationServiceAccessRule(args) {
    const serviceID =
      args && args.length > 1 ? args[1] : args && args.length > 0 ? args[0] : 0;
    log.debug(`[CorpStationMgr] GetStationServiceAccessRule(${serviceID})`);
    const rule = getStationServiceAccessRule(serviceID);
    return buildKeyVal([
      ["serviceID", rule.serviceID],
      ["minimumStanding", rule.minimumStanding],
      ["minimumCharSecurity", rule.minimumCharSecurity],
      ["maximumCharSecurity", rule.maximumCharSecurity],
      ["minimumCorpSecurity", rule.minimumCorpSecurity],
      ["maximumCorpSecurity", rule.maximumCorpSecurity],
    ]);
  }

  Handle_GetStationManagementServiceCostModifiers() {
    log.debug("[CorpStationMgr] GetStationManagementServiceCostModifiers");
    return buildRowset(
      [
        "serviceID",
        "discountPerGoodStandingPoint",
        "surchargePerBadStandingPoint",
      ],
      getStationManagementServiceCostModifiers().map((row) =>
        buildList([
          row.serviceID,
          row.discountPerGoodStandingPoint,
          row.surchargePerBadStandingPoint,
        ]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetRentableItems(args, session) {
    log.debug("[CorpStationMgr] GetRentableItems");
    return buildRowset(
      ["stationID", "typeID", "rentedToID", "publiclyAvailable"],
      getRentableItems(session).map((row) =>
        buildList([
          row.stationID,
          row.typeID,
          row.rentedToID,
          Boolean(row.publiclyAvailable),
        ]),
      ),
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_DoStandingCheckForStationService(args) {
    const serviceID = args && args.length > 0 ? args[0] : 0;
    log.debug(`[CorpStationMgr] DoStandingCheckForStationService(${serviceID})`);
    return null;
  }

  Handle_GetNumberOfUnrentedOffices() {
    log.debug("[CorpStationMgr] GetNumberOfUnrentedOffices");
    return 24;
  }

  Handle_GetQuoteForRentingAnOffice(args, session) {
    log.debug("[CorpStationMgr] GetQuoteForRentingAnOffice");
    return getStationRecord(session).officeRentalCost;
  }

  Handle_GetCorporateStationOffice() {
    log.debug("[CorpStationMgr] GetCorporateStationOffice");
    return buildRowset(
      ["corporationID", "itemID", "officeFolderID"],
      [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetStationOffices() {
    log.debug("[CorpStationMgr] GetStationOffices");
    return buildRowset(
      ["corporationID", "itemID", "officeFolderID"],
      [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetPotentialHomeStations(args, session) {
    log.debug("[CorpStationMgr] GetPotentialHomeStations");
    const station = getStationRecord(session);
    return {
      type: "list",
      items: [
        buildKeyVal([
          ["stationID", station.stationID],
          ["typeID", station.stationTypeID],
          ["serviceMask", 0],
        ]),
      ],
    };
  }

  Handle_GetOwnerIDsOfClonesAtStation() {
    log.debug("[CorpStationMgr] GetOwnerIDsOfClonesAtStation");
    return buildRowset(
      ["ownerID", "corporationID"],
      [],
      "eve.common.script.sys.rowset.Rowset",
    );
  }

  Handle_GetStationImprovements() {
    log.debug("[CorpStationMgr] GetStationImprovements");
    return buildKeyVal([
      ["improvementTier2aTypeID", null],
      ["improvementTier3aTypeID", null],
      ["improvementTier1bTypeID", null],
      ["improvementTier1aTypeID", null],
      ["improvementTier2bTypeID", null],
      ["improvementTier1cTypeID", null],
    ]);
  }
}

module.exports = CorpStationMgrService;
