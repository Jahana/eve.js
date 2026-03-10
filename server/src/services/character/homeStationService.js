const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const {
  getCharacterRecord,
  resolveHomeStationInfo,
} = require(path.join(__dirname, "./characterState"));
const {
  getStationRecord,
} = require(path.join(__dirname, "../_shared/stationStaticData"));
const { buildKeyVal } = require(path.join(__dirname, "../_shared/serviceHelpers"));

function resolveStation(session, args) {
  const charID =
    args && args.length > 0 ? Number(args[0] || 0) : Number(session && session.characterID);
  const charData = charID ? getCharacterRecord(charID) || {} : {};
  const homeStationInfo = resolveHomeStationInfo(charData, session);

  return {
    station: getStationRecord(session, homeStationInfo.homeStationID),
    homeStationInfo,
  };
}

function buildHomeStationPayload(station, homeStationInfo = {}) {
  return buildKeyVal([
    ["id", station.stationID],
    ["station_id", station.stationID],
    ["stationID", station.stationID],
    ["home_station_id", station.stationID],
    ["type_id", station.stationTypeID],
    ["typeID", station.stationTypeID],
    ["station_type_id", station.stationTypeID],
    ["name", station.stationName],
    ["station_name", station.stationName],
    ["stationName", station.stationName],
    ["solar_system_id", station.solarSystemID],
    ["solarSystemID", station.solarSystemID],
    ["constellation_id", station.constellationID],
    ["constellationID", station.constellationID],
    ["region_id", station.regionID],
    ["regionID", station.regionID],
    ["owner_id", station.ownerID],
    ["ownerID", station.ownerID],
    ["clone_station_id", homeStationInfo.cloneStationID || station.stationID],
    ["cloneStationID", homeStationInfo.cloneStationID || station.stationID],
    ["is_fallback", Boolean(homeStationInfo.isFallback)],
    ["isFallback", Boolean(homeStationInfo.isFallback)],
    ["stationTypeID", station.stationTypeID],
  ]);
}

class HomeStationService extends BaseService {
  constructor() {
    super("home_station");
  }

  Handle_get_home_station(args, session) {
    const { station, homeStationInfo } = resolveStation(session, args);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_GetHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_getHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }
}

class HomestationService extends BaseService {
  constructor() {
    super("homestation");
  }

  Handle_get_home_station(args, session) {
    const { station, homeStationInfo } = resolveStation(session, args);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_GetHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_getHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }
}

class HomeStationCamelService extends BaseService {
  constructor() {
    super("homeStation");
  }

  Handle_get_home_station(args, session) {
    const { station, homeStationInfo } = resolveStation(session, args);
    return buildHomeStationPayload(station, homeStationInfo);
  }

  Handle_GetHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }

  Handle_getHomeStation(args, session) {
    return this.Handle_get_home_station(args, session);
  }
}

module.exports = {
  HomeStationService,
  HomestationService,
  HomeStationCamelService,
};
