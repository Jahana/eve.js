/**
 * Online Status Service (onlineStatus)
 *
 * Handles online status queries from the client.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { getCharacterRecord } = require(path.join(
  __dirname,
  "../character/characterState",
));

function toNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
}

function extractCharacterId(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return toNumber(value, 0);
  }

  if (Buffer.isBuffer(value)) {
    return extractCharacterId(value.toString("utf8"));
  }

  if (typeof value === "string") {
    return toNumber(value.trim(), 0);
  }

  if (Array.isArray(value)) {
    for (const candidate of value) {
      const characterId = extractCharacterId(candidate);
      if (characterId > 0) {
        return characterId;
      }
    }
    return 0;
  }

  if (typeof value === "object") {
    if (value.type === "list" && Array.isArray(value.items)) {
      return extractCharacterId(value.items);
    }

    if (Object.prototype.hasOwnProperty.call(value, "characterID")) {
      return extractCharacterId(value.characterID);
    }

    if (Object.prototype.hasOwnProperty.call(value, "charID")) {
      return extractCharacterId(value.charID);
    }

    if (Object.prototype.hasOwnProperty.call(value, "charid")) {
      return extractCharacterId(value.charid);
    }

    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return extractCharacterId(value.value);
    }
  }

  return 0;
}

class OnlineStatusService extends BaseService {
  constructor() {
    super("onlineStatus");
  }

  Handle_GetOnlineStatus(args, session) {
    const requestedCharacterId = extractCharacterId(args);
    const sessionCharacterId = toNumber(
      session && (session.characterID || session.charid),
      0,
    );
    const characterId =
      requestedCharacterId > 0 ? requestedCharacterId : sessionCharacterId;
    const characterRecord = characterId > 0 ? getCharacterRecord(characterId) : null;
    const online = Boolean(characterRecord && characterRecord.online);
    log.debug(`[OnlineStatus] GetOnlineStatus(charID=${characterId}) -> ${online}`);
    return online;
  }

  Handle_GetInitialState(args, session) {
    log.debug("[OnlineStatus] GetInitialState");

    const characterId = toNumber(session && (session.characterID || session.charid), 0);
    const characterRecord = characterId > 0 ? getCharacterRecord(characterId) : null;
    const online = Boolean(characterRecord && characterRecord.online);
    const rows = characterId > 0
      ? [
          {
            type: "object",
            name: "util.Row",
            args: {
              type: "dict",
              entries: [
                ["charID", characterId],
                ["online", online],
              ],
            },
          },
        ]
      : [];

    return {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          // Provide Index token so client can call .Index('charID') without crashing
          ["Index", { type: "token", value: "util.Row" }],

          // Provide rows for online characters
          [
            "rows",
            {
              type: "list",
              items: rows,
            },
          ],
        ],
      },
    };
  }
}

module.exports = OnlineStatusService;
