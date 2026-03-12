/**
 * LSC (Large Scale Chat) Service
 *
 * Handles chat channel operations.
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const chatHub = require(path.join(__dirname, "./chatHub"));

function getExecuteChatCommand() {
  return require(path.join(__dirname, "./chatCommands")).executeChatCommand;
}

function collectTextValues(value, results, depth = 0) {
  if (depth > 8) {
    return;
  }

  if (typeof value === "string") {
    results.push(value);
    return;
  }

  if (Buffer.isBuffer(value)) {
    results.push(value.toString("utf8"));
    return;
  }

  if (
    value &&
    typeof value === "object" &&
    (value.type === "wstring" || value.type === "token")
  ) {
    collectTextValues(value.value, results, depth + 1);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextValues(item, results, depth + 1);
    }
    return;
  }

  if (value && typeof value === "object") {
    if (value.type === "substream" || value.type === "substruct") {
      collectTextValues(value.value, results, depth + 1);
      return;
    }

    if (value.type === "list" && Array.isArray(value.items)) {
      collectTextValues(value.items, results, depth + 1);
      return;
    }

    if (value.type === "dict" && Array.isArray(value.entries)) {
      for (const [, entryValue] of value.entries) {
        collectTextValues(entryValue, results, depth + 1);
      }
      return;
    }

    if (value.type === "object" && value.args) {
      collectTextValues(value.args, results, depth + 1);
      return;
    }

    if (value.args) {
      collectTextValues(value.args, results, depth + 1);
    }

    if (value.value !== undefined) {
      collectTextValues(value.value, results, depth + 1);
    }

    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (
        entryKey === "type" ||
        entryKey === "name" ||
        entryKey === "args" ||
        entryKey === "value"
      ) {
        continue;
      }

      collectTextValues(entryValue, results, depth + 1);
    }
  }
}

function extractMessage(args, kwargs) {
  const candidates = [];
  collectTextValues(args, candidates);
  collectTextValues(kwargs, candidates);

  const normalizedCandidates = candidates
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (normalizedCandidates.length === 0) {
    return "";
  }

  const slashCandidates = normalizedCandidates.filter(
    (entry) =>
      (entry.startsWith("/") || entry.startsWith(".")) && entry.length > 1,
  );
  if (slashCandidates.length > 0) {
    return slashCandidates.sort((left, right) => {
      const leftWords = left.split(/\s+/).length;
      const rightWords = right.split(/\s+/).length;
      if (leftWords !== rightWords) {
        return rightWords - leftWords;
      }

      return right.length - left.length;
    })[0];
  }

  const plainCommandCandidates = normalizedCandidates.filter(
    (entry) => /^[A-Za-z][\w-]*(\s+.+)?$/.test(entry),
  );
  if (plainCommandCandidates.length > 0) {
    const bestPlainCandidate = plainCommandCandidates.sort(
      (left, right) => right.length - left.length,
    )[0];
    return `/${bestPlainCandidate}`;
  }

  return normalizedCandidates[normalizedCandidates.length - 1] || "";
}

class LSCService extends BaseService {
  constructor() {
    super("LSC");
  }

  Handle_GetChannels(args, session) {
    log.debug("[LSCService] GetChannels");
    return chatHub.getChannelsForSession(session);
  }

  Handle_GetMyMessages(args, session) {
    log.debug("[LSCService] GetMyMessages");
    return { type: "list", items: [] };
  }

  Handle_JoinChannels(args, session) {
    log.debug("[LSCService] JoinChannels");
    const { result } = chatHub.joinLocalChannel(session);
    return { type: "list", items: [result] };
  }

  Handle_JoinChannel(args, session) {
    log.debug("[LSCService] JoinChannel");
    const { result } = chatHub.joinLocalChannel(session);
    return result;
  }

  Handle_LeaveChannels(args, session) {
    log.debug("[LSCService] LeaveChannels");
    chatHub.leaveLocalChannel(session);
    return null;
  }

  Handle_LeaveChannel(args, session) {
    log.debug("[LSCService] LeaveChannel");
    chatHub.leaveLocalChannel(session);
    return null;
  }

  Handle_SendMessage(args, session, kwargs) {
    const message = extractMessage(args, kwargs);
    log.debug(`[LSCService] SendMessage: ${message}`);

    if (!message) {
      return null;
    }

    const commandResult = getExecuteChatCommand()(session, message, chatHub);
    if (!commandResult.handled) {
      chatHub.broadcastLocalMessage(session, message);
    }

    return null;
  }
}

module.exports = LSCService;
