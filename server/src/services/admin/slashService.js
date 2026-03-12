const path = require("path");
const fs = require("fs");

const BaseService = require(path.join(__dirname, "../baseService"));
const config = require(path.join(__dirname, "../../config"));
const log = require(path.join(__dirname, "../../utils/logger"));
const chatHub = require(path.join(__dirname, "../chat/chatHub"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));

const debugLogPath = path.join(__dirname, "../../../logs/slash-debug.log");

function getChatCommands() {
  return require(path.join(__dirname, "../chat/chatCommands"));
}

function isSlashDebugTraceEnabled() {
  return Boolean(config.enableSlashDebugTrace);
}

function appendSlashDebug(entry) {
  if (!isSlashDebugTraceEnabled()) {
    return;
  }

  try {
    const resolvedEntry =
      typeof entry === "function" ? entry() : String(entry || "");
    if (!resolvedEntry) {
      return;
    }

    fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
    fs.appendFileSync(
      debugLogPath,
      `[${new Date().toISOString()}] ${resolvedEntry}\n`,
      "utf8",
    );
  } catch (error) {
    log.warn(`[SlashService] Failed to write debug log: ${error.message}`);
  }
}

function textValue(value, depth = 0) {
  if (depth > 8) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (
    value &&
    typeof value === "object" &&
    (value.type === "wstring" || value.type === "token")
  ) {
    return textValue(value.value, depth + 1);
  }

  if (Array.isArray(value)) {
    const extractedValues = value
      .map((item) => textValue(item, depth + 1).trim())
      .filter(Boolean);
    return extractedValues.sort((left, right) => right.length - left.length)[0] || "";
  }

  if (value && typeof value === "object") {
    if (value.type === "substream" || value.type === "substruct") {
      return textValue(value.value, depth + 1);
    }

    if (value.type === "list" && Array.isArray(value.items)) {
      return textValue(value.items, depth + 1);
    }

    if (value.type === "dict" && Array.isArray(value.entries)) {
      const extractedValues = value.entries
        .map(([, entryValue]) => textValue(entryValue, depth + 1).trim())
        .filter(Boolean);
      return extractedValues.sort((left, right) => right.length - left.length)[0] || "";
    }

    if (value.type === "object" && value.args) {
      return textValue(value.args, depth + 1);
    }

    const extractedValues = [];
    if (value.args) {
      extractedValues.push(textValue(value.args, depth + 1).trim());
    }
    if (value.value !== undefined) {
      extractedValues.push(textValue(value.value, depth + 1).trim());
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
      extractedValues.push(textValue(entryValue, depth + 1).trim());
    }

    return extractedValues.filter(Boolean).sort((left, right) => right.length - left.length)[0] || "";
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function summarizeValue(value, depth = 0) {
  if (depth > 3) {
    return "<max-depth>";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer:${value.toString("utf8")}>`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => summarizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const summary = {};
    for (const [key, entryValue] of Object.entries(value)) {
      summary[key] = summarizeValue(entryValue, depth + 1);
    }
    return summary;
  }

  return String(value);
}

function extractCommand(args, kwargs) {
  const fromArgs = textValue(args).trim();
  if (fromArgs) {
    return fromArgs;
  }

  const fromKwargs = textValue(kwargs).trim();
  if (fromKwargs) {
    return fromKwargs;
  }

  return "";
}

class SlashService extends BaseService {
  constructor() {
    super("slash");
  }

  _throwCommandListError() {
    const { AVAILABLE_SLASH_COMMANDS } = getChatCommands();
    const quotedCommands = AVAILABLE_SLASH_COMMANDS.map(
      (command) => `'${command}'`,
    ).join(", ");
    throwWrappedUserError("", {
      reason: `Commands: [${quotedCommands}]`,
    });
  }

  _buildCommandListMessage() {
    const { AVAILABLE_SLASH_COMMANDS } = getChatCommands();
    return `Commands: ${AVAILABLE_SLASH_COMMANDS.map((command) => `/${command}`).join(", ")}`;
  }

  Handle_ReportSlashCommandUsage(args, session, kwargs) {
    const command = extractCommand(args, kwargs);
    appendSlashDebug(() =>
      `ReportSlashCommandUsage user=${session ? session.userid : "?"} char=${session ? session.characterID : "?"} command=${JSON.stringify(command)} args=${JSON.stringify(summarizeValue(args))} kwargs=${JSON.stringify(summarizeValue(kwargs))}`,
    );
    return null;
  }

  Handle_SlashCmd(args, session, kwargs) {
    const command = extractCommand(args, kwargs).trim();

    log.debug(`[SlashService] SlashCmd: ${command}`);
    appendSlashDebug(() =>
      `SlashCmd user=${session ? session.userid : "?"} char=${session ? session.characterID : "?"} command=${JSON.stringify(command)} args=${JSON.stringify(summarizeValue(args))} kwargs=${JSON.stringify(summarizeValue(kwargs))}`,
    );

    if (command === "/" || !command) {
      this._throwCommandListError();
    }

    try {
      const { executeChatCommand } = getChatCommands();
      const result = executeChatCommand(session, command, chatHub, {
        emitChatFeedback: true,
      });

      if (!result.handled) {
        const message = `Unknown command: ${command}. Use /help.`;
        chatHub.sendSystemMessage(session, message);
        return message;
      }

      return result.message || null;
    } catch (error) {
      if (error && error.machoErrorResponse) {
        throw error;
      }

      const message = `Command failed: ${error.message}`;
      log.err(`[SlashService] ${message}`);
      appendSlashDebug(() =>
        `SlashCmd error user=${session ? session.userid : "?"} char=${session ? session.characterID : "?"} command=${JSON.stringify(command)} args=${JSON.stringify(summarizeValue(args))} kwargs=${JSON.stringify(summarizeValue(kwargs))} error=${error.stack || error.message}`,
      );
      chatHub.sendSystemMessage(session, message);
      return message;
    }
  }
}

module.exports = SlashService;
