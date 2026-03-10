const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  buildDict,
  buildKeyVal,
  buildList,
  buildRowset,
  normalizeNumber,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function buildTutorialInfo(tutorialId) {
  return buildKeyVal([
    [
      "tutorial",
      buildKeyVal([
        ["tutorialID", tutorialId],
        ["categoryID", null],
      ]),
    ],
    ["pages", buildList([])],
    ["pagecriterias", buildList([])],
    ["criterias", buildList([])],
  ]);
}

class TutorialSvcService extends BaseService {
  constructor() {
    super("tutorialSvc");
  }

  Handle_GetTutorials() {
    log.debug("[TutorialSvc] GetTutorials");
    return buildRowset(["tutorialID", "tutorialNameID", "categoryID"], []);
  }

  Handle_GetTutorialInfo(args) {
    const tutorialId = normalizeNumber(args && args[0], 0);
    log.debug(`[TutorialSvc] GetTutorialInfo(${tutorialId})`);
    return buildTutorialInfo(tutorialId);
  }

  Handle_GetTutorialAgents() {
    log.debug("[TutorialSvc] GetTutorialAgents");
    return buildRowset(
      [
        "agentID",
        "agentTypeID",
        "divisionID",
        "level",
        "stationID",
        "bloodlineID",
        "quality",
        "corporationID",
        "gender",
      ],
      [],
    );
  }

  Handle_GetCriterias() {
    log.debug("[TutorialSvc] GetCriterias");
    return buildRowset(
      ["criteriaID", "messageTextID", "criteriaTypeID", "pageCriteriaID"],
      [],
    );
  }

  Handle_GetCategories() {
    log.debug("[TutorialSvc] GetCategories");
    return buildRowset(
      ["categoryID", "categoryNameID", "descriptionID"],
      [],
    );
  }

  Handle_GetActions() {
    log.debug("[TutorialSvc] GetActions");
    return buildRowset(["actionID", "actionTypeID", "actionData"], []);
  }

  Handle_GetCharacterTutorialState() {
    log.debug("[TutorialSvc] GetCharacterTutorialState");
    return 0;
  }

  Handle_GetTutorialsAndConnections() {
    log.debug("[TutorialSvc] GetTutorialsAndConnections");
    return [
      buildRowset(["tutorialID", "tutorialNameID", "categoryID"], []),
      buildRowset(["tutorialID", "raceID", "nextTutorialID"], []),
    ];
  }

  Handle_GetCareerAgents() {
    log.debug("[TutorialSvc] GetCareerAgents");
    return buildDict([]);
  }

  Handle_LogCompleted() {
    return null;
  }

  Handle_LogAborted() {
    return null;
  }

  Handle_LogStarted() {
    return null;
  }

  Handle_LogClosed() {
    return null;
  }

  Handle_LogAppClosed() {
    return null;
  }
}

module.exports = TutorialSvcService;
