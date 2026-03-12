const {
  spawnShipInHangarForSession,
  getActiveShipRecord,
  activateShipForSession,
  syncInventoryItemForSession,
} = require("../character/characterState");
const sessionRegistry = require("./sessionRegistry");
const {
  getAllItems,
  getCharacterHangarShipItems,
  createInventoryItemForCharacter,
  ITEM_FLAGS,
} = require("../inventory/itemStore");
const {
  resolveModuleByTypeID,
  resolveModuleByName,
} = require("../inventory/moduleTypeRegistry");
const {
  getCharacterWallet,
  setCharacterBalance,
  adjustCharacterBalance,
} = require("../account/walletState");
const {
  resolveShipByName,
  resolveShipByTypeID,
} = require("./shipTypeRegistry");
const { getHotReloadController } = require("../../hotReload");
const COMMAND_FEEDBACK_DELAY_MS = 150;

const DEFAULT_MOTD_MESSAGE = [
  "Welcome to EvEJS.",
  "This emulator build is still work in progress.",
  "Local chat and slash commands are enabled.",
  "Use /help to see the current command list.",
].join(" ");
const AVAILABLE_SLASH_COMMANDS = [
  "addisk",
  "announce",
  "commandlist",
  "commands",
  "giveme",
  "hangar",
  "help",
  "item",
  "fit",
  "load",
  "motd",
  "reload",
  "session",
  "setisk",
  "ship",
  "tr",
  "typeinfo",
  "wallet",
  "where",
  "who",
];
const COMMANDS_HELP_TEXT = [
  "Commands:",
  "/help",
  "/motd",
  "/reload",
  "/where",
  "/who",
  "/wallet",
  "/addisk <amount>",
  "/setisk <amount>",
  "/ship <ship name>",
  "/giveme <ship name>",
  "/load <character|me> <typeID> [quantity]",
  "/load <ship name|typeID|DNA|EFT>",
  "/fit <character|me> <typeID> [quantity]",
  "/fit <ship name|typeID|DNA|EFT>",
  "/hangar",
  "/item <itemID>",
  "/typeinfo <ship name>",
  "/session",
  "/tr <character|me> <locationID>",
  "/announce <message>",
].join(" ");

function normalizeCommandName(value) {
  return String(value || "").trim().toLowerCase();
}

function getTeleportSession() {
  return require("../../space/transitions").teleportSession;
}

function formatIsk(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ISK`;
}

function parseAmount(value) {
  const text = String(value || "")
    .trim()
    .replace(/,/g, "")
    .replace(/_/g, "");
  if (!text) {
    return null;
  }

  const match = /^(-?\d+(?:\.\d+)?)([kmbt])?$/i.exec(text);
  if (!match) {
    return null;
  }

  const baseValue = Number(match[1]);
  if (!Number.isFinite(baseValue)) {
    return null;
  }

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
    t: 1_000_000_000_000,
  };
  const suffix = String(match[2] || "").toLowerCase();
  return baseValue * (multiplier[suffix] || 1);
}

function formatSuggestions(suggestions) {
  if (!suggestions || suggestions.length === 0) {
    return "";
  }

  return ` Suggestions: ${suggestions.join(", ")}`;
}

function emitChatFeedback(chatHub, session, options, message) {
  if (!message) {
    return;
  }

  if (
    chatHub &&
    session &&
    (!options || options.emitChatFeedback !== false)
  ) {
    const delayMs =
      options && Number.isFinite(Number(options.chatFeedbackDelayMs))
        ? Math.max(0, Number(options.chatFeedbackDelayMs))
        : COMMAND_FEEDBACK_DELAY_MS;

    setTimeout(() => {
      if (!session.socket || session.socket.destroyed) {
        return;
      }

      chatHub.sendSystemMessage(session, message);
    }, delayMs);
  }
}

function handledResult(chatHub, session, options, message) {
  emitChatFeedback(chatHub, session, options, message);
  return {
    handled: true,
    message,
  };
}

function getWalletSummary(session) {
  const wallet = session && session.characterID
    ? getCharacterWallet(session.characterID)
    : null;
  if (!wallet) {
    return null;
  }

  const deltaText =
    wallet.balanceChange === 0
      ? "0.00 ISK"
      : `${wallet.balanceChange > 0 ? "+" : ""}${formatIsk(wallet.balanceChange)}`;

  return `Wallet balance: ${formatIsk(wallet.balance)}. Last change: ${deltaText}.`;
}

function getLocationSummary(session) {
  if (!session || !session.characterID) {
    return "No character selected.";
  }

  if (session.stationid || session.stationID) {
    return `Docked in station ${session.stationid || session.stationID}, solar system ${session.solarsystemid2 || session.solarsystemid || "unknown"}.`;
  }

  if (session.solarsystemid2 || session.solarsystemid) {
    return `In space in solar system ${session.solarsystemid2 || session.solarsystemid}.`;
  }

  return "Current location is unknown.";
}

function getConnectedCharacterSummary() {
  const connected = sessionRegistry
    .getSessions()
    .filter((session) => Number(session.characterID || 0) > 0)
    .map(
      (session) =>
        `${session.characterName || session.userName || "Unknown"}(${session.characterID})`,
    );

  if (connected.length === 0) {
    return "No active characters are connected.";
  }

  return `Connected characters (${connected.length}): ${connected.join(", ")}`;
}

function getSessionSummary(session) {
  if (!session || !session.characterID) {
    return "No active character session.";
  }

  return [
    `char=${session.characterName || "Unknown"}(${session.characterID})`,
    `ship=${session.shipName || "Ship"}(${session.shipID || session.shipid || 0})`,
    `corp=${session.corporationID || 0}`,
    `station=${session.stationid || session.stationID || 0}`,
    `system=${session.solarsystemid2 || session.solarsystemid || 0}`,
    `wallet=${formatIsk(session.balance || 0)}`,
  ].join(" | ");
}

function resolveTeleportTargetSession(invokingSession, targetText) {
  const normalizedTarget = normalizeCommandName(targetText);
  if (!normalizedTarget) {
    return null;
  }

  if (
    normalizedTarget === "me" ||
    normalizedTarget === "self" ||
    normalizedTarget === String(invokingSession && invokingSession.characterID)
  ) {
    return invokingSession;
  }

  const numericTarget = Number(normalizedTarget);
  const activeSessions = sessionRegistry
    .getSessions()
    .filter((candidate) => Number(candidate && candidate.characterID) > 0);

  if (Number.isInteger(numericTarget) && numericTarget > 0) {
    const byId = activeSessions.find(
      (candidate) => Number(candidate.characterID || candidate.charid || 0) === numericTarget,
    );
    if (byId) {
      return byId;
    }
  }

  return (
    activeSessions.find(
      (candidate) =>
        normalizeCommandName(candidate.characterName || candidate.userName) === normalizedTarget,
    ) || null
  );
}

function getHangarSummary(session) {
  if (!session || !session.characterID) {
    return "No active character session.";
  }

  const stationId = session.stationid || session.stationID;
  if (!stationId) {
    return "You must be docked to inspect the station ship hangar.";
  }

  const activeShip = getActiveShipRecord(session.characterID);
  const hangarShips = getCharacterHangarShipItems(session.characterID, stationId);
  const shipSummary = hangarShips
    .map((ship) => `${ship.itemName}(${ship.itemID})`)
    .join(", ");

  return [
    `Active ship: ${activeShip ? `${activeShip.itemName}(${activeShip.itemID})` : "none"}.`,
    `Hangar ships (${hangarShips.length}): ${shipSummary || "none"}.`,
  ].join(" ");
}

function getItemSummary(argumentText) {
  const itemID = Number(argumentText);
  if (!Number.isInteger(itemID) || itemID <= 0) {
    return "Usage: /item <itemID>";
  }

  const item = getAllItems()[String(itemID)];
  if (!item) {
    return `Item not found: ${itemID}.`;
  }

  return [
    `Item ${item.itemID}: ${item.itemName || "Unknown"}`,
    `type=${item.typeID}`,
    `owner=${item.ownerID}`,
    `location=${item.locationID}`,
    `flag=${item.flagID}`,
    `singleton=${item.singleton}`,
    `quantity=${item.quantity}`,
  ].join(" | ");
}

function sendAnnouncement(chatHub, session, message) {
  if (!message) {
    return;
  }

  for (const targetSession of sessionRegistry.getSessions()) {
    if (chatHub) {
      chatHub.sendSystemMessage(targetSession, message);
    }
  }
}

function handleShipSpawn(commandLabel, session, argumentText, chatHub, options) {
  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: /${commandLabel} <ship name>`,
    );
  }

  const shipLookup = resolveShipByName(argumentText);
  if (!shipLookup.success) {
    const message =
      shipLookup.errorMsg === "SHIP_NOT_FOUND"
        ? `Ship not found: ${argumentText}.${formatSuggestions(shipLookup.suggestions)}`
        : `Ship name is ambiguous: ${argumentText}.${formatSuggestions(shipLookup.suggestions)}`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const spawnResult = spawnShipInHangarForSession(session, shipLookup.match);
  if (!spawnResult.success) {
    let message = "Ship spawn failed.";
    if (spawnResult.errorMsg === "DOCK_REQUIRED") {
      message = "You must be docked before spawning ships into your hangar.";
    } else if (spawnResult.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character before spawning ships.";
    }
    return handledResult(chatHub, session, options, message);
  }

  return handledResult(
    chatHub,
    session,
    options,
    `${shipLookup.match.name} was added to your ship hangar. /${commandLabel} only spawns the hull for now; board it manually from the hangar.`,
  );
}

function unquoteArgument(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  return text;
}

function parseLegacyLoadRequest(argumentText) {
  const match =
    /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s+(\d+)(?:\s+(\d+))?\s*$/.exec(
      String(argumentText || ""),
    );
  if (!match) {
    return null;
  }

  const targetText = unquoteArgument(match[1] || match[2] || match[3] || "");
  const typeID = Number(match[4]);
  const quantity = match[5] ? Number(match[5]) : 1;
  if (!targetText || !Number.isInteger(typeID) || typeID <= 0) {
    return null;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_QUANTITY",
      targetText,
      typeID,
      quantity,
    };
  }

  return {
    success: true,
    targetText,
    typeID,
    quantity,
  };
}

function grantLegacyTypeToSession(targetSession, typeID, quantity) {
  if (!targetSession || !targetSession.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const shipType = resolveShipByTypeID(typeID);
  if (shipType) {
    const stationId = targetSession.stationid || targetSession.stationID;
    if (!stationId) {
      return {
        success: false,
        errorMsg: "DOCK_REQUIRED_FOR_SHIP",
      };
    }

    const spawnedShips = [];
    for (let index = 0; index < quantity; index += 1) {
      const spawnResult = spawnShipInHangarForSession(targetSession, shipType);
      if (!spawnResult.success) {
        return spawnResult;
      }

      spawnedShips.push(spawnResult.ship);
    }

    return {
      success: true,
      kind: "ship",
      quantity,
      entry: shipType,
      containerLabel: "ship hangar",
      items: spawnedShips,
    };
  }

  const stationId = targetSession.stationid || targetSession.stationID;
  const shipId = targetSession.shipID || targetSession.shipid || 0;
  const moduleType = resolveModuleByTypeID(typeID);
  if (!moduleType) {
    return {
      success: false,
      errorMsg: "UNSUPPORTED_TYPE_ID",
    };
  }

  const locationID = stationId || shipId;
  const flagID = stationId ? ITEM_FLAGS.HANGAR : shipId ? ITEM_FLAGS.CARGO_HOLD : 0;
  if (!locationID || !flagID) {
    return {
      success: false,
      errorMsg: "NO_DESTINATION",
    };
  }

  const createResult = createInventoryItemForCharacter(
    targetSession.characterID,
    locationID,
    moduleType,
    {
      flagID,
      quantity,
      stacksize: quantity,
      singleton: 0,
    },
  );
  if (!createResult.success) {
    return createResult;
  }

  syncInventoryItemForSession(
    targetSession,
    createResult.data,
    createResult.previousData || {
      locationID: 0,
      flagID: 0,
      quantity: 0,
      singleton: createResult.data.singleton,
      stacksize: 0,
    },
    {
      emitCfgLocation: true,
    },
  );

  return {
    success: true,
    kind: "item",
    quantity,
    entry: createResult.data,
    requestedTypeID: typeID,
    containerLabel: stationId ? "item hangar" : "cargo hold",
  };
}

function resolveShipSpec(argumentText) {
  const rawText = String(argumentText || "").trim();
  if (!rawText) {
    return {
      success: false,
      errorMsg: "SHIP_NAME_REQUIRED",
      suggestions: [],
    };
  }

  const normalizedText = rawText.replace(/^<url=fitting:/i, "").replace(/>.*$/s, "");
  const dnaMatch = /^(\d+)(?::.*)?$/.exec(normalizedText);
  if (
    dnaMatch &&
    (normalizedText.includes(";") || normalizedText.includes(":"))
  ) {
    const byType = resolveShipByTypeID(Number(dnaMatch[1]));
    if (!byType) {
      return {
        success: false,
        errorMsg: "SHIP_NOT_FOUND",
        suggestions: [],
      };
    }

    return {
      success: true,
      match: byType,
      source: "DNA",
      fittingPayloadIncluded: normalizedText.includes(";"),
    };
  }

  const eftMatch = /^\[([^,\]]+)\s*,/m.exec(rawText);
  if (eftMatch) {
    const lookup = resolveShipByName(eftMatch[1]);
    if (lookup.success) {
      return {
        ...lookup,
        source: "EFT",
        fittingPayloadIncluded: true,
      };
    }

    return lookup;
  }

  const numericTypeID = Number(rawText);
  if (Number.isInteger(numericTypeID) && numericTypeID > 0) {
    const byType = resolveShipByTypeID(numericTypeID);
    if (byType) {
      return {
        success: true,
        match: byType,
        source: "typeID",
        fittingPayloadIncluded: false,
      };
    }
  }

  const lookup = resolveShipByName(rawText);
  if (!lookup.success) {
    return lookup;
  }

  return {
    ...lookup,
    source: "name",
    fittingPayloadIncluded: false,
  };
}

function loadShipForSession(session, shipSpec) {
  if (!session || !session.characterID) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_SELECTED",
    };
  }

  const stationId = session.stationid || session.stationID;
  if (!stationId) {
    return {
      success: false,
      errorMsg: "DOCK_REQUIRED",
    };
  }

  const activeShip = getActiveShipRecord(session.characterID);
  if (activeShip && Number(activeShip.typeID || 0) === Number(shipSpec.typeID || 0)) {
    return {
      success: true,
      alreadyActive: true,
      created: false,
      ship: activeShip,
    };
  }

  const hangarShips = getCharacterHangarShipItems(session.characterID, stationId);
  const existingShip =
    hangarShips.find(
      (ship) => Number(ship.typeID || 0) === Number(shipSpec.typeID || 0),
    ) || null;
  let targetShip = existingShip;
  let created = false;

  if (!targetShip) {
    const spawnResult = spawnShipInHangarForSession(session, shipSpec);
    if (!spawnResult.success) {
      return spawnResult;
    }

    targetShip = spawnResult.ship;
    created = Boolean(spawnResult.created);
  }

  const activationResult = activateShipForSession(session, targetShip.itemID, {
    emitNotifications: true,
    logSelection: true,
  });
  if (!activationResult.success) {
    return activationResult;
  }

  return {
    success: true,
    alreadyActive: false,
    created,
    ship: activationResult.activeShip || targetShip,
  };
}

function handleLoadLikeCommand(commandLabel, session, argumentText, chatHub, options) {
  if (!argumentText) {
    return handledResult(
      chatHub,
      session,
      options,
      `Usage: /${commandLabel} <character|me> <typeID> [quantity] | <ship name|typeID|DNA|EFT>`,
    );
  }

  const legacyLoadRequest = parseLegacyLoadRequest(argumentText);
  if (legacyLoadRequest) {
    if (!legacyLoadRequest.success) {
      return handledResult(
        chatHub,
        session,
        options,
        `Usage: /${commandLabel} <character|me> <typeID> [quantity]`,
      );
    }

    const targetSession = resolveTeleportTargetSession(
      session,
      legacyLoadRequest.targetText,
    );
    if (!targetSession) {
      return handledResult(
        chatHub,
        session,
        options,
        `Character not found: ${legacyLoadRequest.targetText}.`,
      );
    }

    const grantResult = grantLegacyTypeToSession(
      targetSession,
      legacyLoadRequest.typeID,
      legacyLoadRequest.quantity,
    );
    if (!grantResult.success) {
      let message = `${commandLabel} failed.`;
      if (grantResult.errorMsg === "DOCK_REQUIRED") {
        message = "You must be docked before spawning ships into the hangar.";
      } else if (grantResult.errorMsg === "DOCK_REQUIRED_FOR_SHIP") {
        message = "You must be docked before loading ships by typeID.";
      } else if (grantResult.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Select a character first.";
      } else if (grantResult.errorMsg === "NO_DESTINATION") {
        message = "Target character must be docked or have an active ship.";
      } else if (grantResult.errorMsg === "UNSUPPORTED_TYPE_ID") {
        message = `Unsupported typeID: ${legacyLoadRequest.typeID}. Use a valid ship/module typeID.`;
      }
      return handledResult(chatHub, session, options, message);
    }

    const targetName =
      targetSession.characterName || targetSession.userName || legacyLoadRequest.targetText;
    const fitNote =
      commandLabel === "fit"
        ? " Module fitting is not implemented yet, so the item was only added to inventory."
        : "";
    const descriptor =
      grantResult.kind === "ship"
        ? grantResult.entry.name
        : grantResult.entry.itemName || grantResult.entry.name || `typeID ${legacyLoadRequest.typeID}`;
    const quantityText =
      grantResult.quantity > 1 ? ` x${grantResult.quantity}` : "";
    return handledResult(
      chatHub,
      session,
      options,
      `Loaded ${descriptor}${quantityText} for ${targetName} into the ${grantResult.containerLabel}.${fitNote}`.trim(),
    );
  }

  const shipSpec = resolveShipSpec(argumentText);
  if (!shipSpec.success) {
    if (shipSpec.errorMsg === "SHIP_NOT_FOUND") {
      const numericTypeID = Number(argumentText);
      const moduleByTypeID =
        Number.isInteger(numericTypeID) && numericTypeID > 0
          ? resolveModuleByTypeID(numericTypeID)
          : null;
      const moduleLookup =
        moduleByTypeID
          ? {
              success: true,
              match: moduleByTypeID,
              suggestions: [],
            }
          : Number.isInteger(numericTypeID) && numericTypeID > 0
            ? {
                success: false,
                match: null,
                suggestions: [],
                errorMsg: "MODULE_NOT_FOUND",
              }
            : resolveModuleByName(argumentText);

      if (moduleLookup && moduleLookup.success && moduleLookup.match) {
        const grantResult = grantLegacyTypeToSession(
          session,
          moduleLookup.match.typeID,
          1,
        );
        if (!grantResult.success) {
          let message = `${commandLabel} failed.`;
          if (grantResult.errorMsg === "CHARACTER_NOT_SELECTED") {
            message = "Select a character first.";
          } else if (grantResult.errorMsg === "NO_DESTINATION") {
            message = "You must be docked or have an active ship to receive modules.";
          } else if (grantResult.errorMsg === "UNSUPPORTED_TYPE_ID") {
            message = `Unsupported typeID: ${moduleLookup.match.typeID}.`;
          }
          return handledResult(chatHub, session, options, message);
        }

        const fitNote =
          commandLabel === "fit"
            ? " Module fitting is not implemented yet, so the item was only added to inventory."
            : "";
        return handledResult(
          chatHub,
          session,
          options,
          `Loaded ${moduleLookup.match.name} into the ${grantResult.containerLabel}.${fitNote}`.trim(),
        );
      }

      const combinedSuggestions = [
        ...(Array.isArray(shipSpec.suggestions) ? shipSpec.suggestions : []),
        ...(moduleLookup && Array.isArray(moduleLookup.suggestions)
          ? moduleLookup.suggestions
          : []),
      ]
        .filter(Boolean)
        .slice(0, 5);
      const message = Number.isInteger(numericTypeID) && numericTypeID > 0
        ? `Unsupported typeID: ${numericTypeID}. Use a valid ship/module typeID.${formatSuggestions(combinedSuggestions)}`
        : `Ship or module not found: ${argumentText}.${formatSuggestions(combinedSuggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }

    const message =
      shipSpec.errorMsg === "AMBIGUOUS_SHIP_NAME"
        ? `Ship name is ambiguous: ${argumentText}.${formatSuggestions(shipSpec.suggestions)}`.trim()
        : `Usage: /${commandLabel} <character|me> <typeID> [quantity] | <ship name|typeID|DNA|EFT>`;
    return handledResult(chatHub, session, options, message.trim());
  }

  const result = loadShipForSession(session, shipSpec.match);
  if (!result.success) {
    let message = `${commandLabel} failed.`;
    if (result.errorMsg === "DOCK_REQUIRED") {
      message = `You must be docked before using /${commandLabel}.`;
    } else if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
      message = "Select a character first.";
    }
    return handledResult(chatHub, session, options, message);
  }

  const fitNote =
    commandLabel === "fit" || shipSpec.fittingPayloadIncluded
      ? " Module fitting is not implemented yet, so only the hull was loaded."
      : "";
  const actionText = result.alreadyActive
    ? `${shipSpec.match.name} is already your active ship.`
    : `${shipSpec.match.name} is now active${result.created ? " (new hull spawned)" : ""}.`;
  return handledResult(
    chatHub,
    session,
    options,
    `${actionText} Source=${shipSpec.source}.${fitNote}`.trim(),
  );
}

function getHotReloadSummary() {
  const controller = getHotReloadController();
  if (!controller) {
    return "Hot reload is disabled.";
  }

  const status = controller.getStatus();
  const lastReloadText = status.lastReloadAt
    ? `last=${status.lastReloadAt}`
    : "last=never";
  const restartText = status.restartPending
    ? `restart=pending(${(status.pendingRestartFiles || []).join(", ") || "unknown"})`
    : "restart=clear";
  return [
    `Hot reload: watch=${status.watchEnabled ? "on" : "off"}`,
    `watching=${status.watching ? "yes" : "no"}`,
    `count=${status.reloadCount}`,
    lastReloadText,
    restartText,
  ].join(" | ");
}

function executeChatCommand(session, rawMessage, chatHub, options = {}) {
  const trimmed = String(rawMessage || "").trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith(".")) {
    return { handled: false };
  }

  const commandLine = trimmed.slice(1).trim();
  if (!commandLine) {
    return handledResult(
      chatHub,
      session,
      options,
      "No command supplied. Use /help.",
    );
  }

  const [commandName, ...rest] = commandLine.split(/\s+/);
  const command = normalizeCommandName(commandName);
  const argumentText = rest.join(" ").trim();

  if (
    command === "help" ||
    command === "commands" ||
    command === "commandlist"
  ) {
    return handledResult(chatHub, session, options, COMMANDS_HELP_TEXT);
  }

  if (command === "motd") {
    return handledResult(chatHub, session, options, DEFAULT_MOTD_MESSAGE);
  }

  if (command === "reload") {
    const controller = getHotReloadController();
    if (!controller) {
      return handledResult(chatHub, session, options, "Hot reload is disabled.");
    }

    if (!argumentText || normalizeCommandName(argumentText) === "now") {
      const result = controller.reloadNow("slash");
      if (!result.success) {
        return handledResult(
          chatHub,
          session,
          options,
          `Reload failed: ${result.error || "unknown error"}.`,
        );
      }

      const restartNote =
        result.restartRequiredFiles && result.restartRequiredFiles.length > 0
          ? ` Restart still required for: ${result.restartRequiredFiles.join(", ")}.`
          : "";
      return handledResult(
        chatHub,
        session,
        options,
        `Reloaded ${result.serviceCount} services at ${result.at}.${restartNote}`.trim(),
      );
    }

    if (normalizeCommandName(argumentText) === "status") {
      return handledResult(chatHub, session, options, getHotReloadSummary());
    }

    return handledResult(
      chatHub,
      session,
      options,
      "Usage: /reload [now|status]",
    );
  }

  if (command === "where") {
    return handledResult(chatHub, session, options, getLocationSummary(session));
  }

  if (command === "who") {
    return handledResult(
      chatHub,
      session,
      options,
      getConnectedCharacterSummary(),
    );
  }

  if (command === "wallet" || command === "isk") {
    const summary = getWalletSummary(session);
    return handledResult(
      chatHub,
      session,
      options,
      summary || "Select a character before checking wallet balance.",
    );
  }

  if (command === "addisk") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing wallet balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /addisk <amount>",
      );
    }

    const result = adjustCharacterBalance(session.characterID, amount, {
      description: `Admin /addisk by ${session.characterName || session.userName || "unknown"}`,
      ownerID1: session.characterID,
      ownerID2: session.characterID,
      referenceID: session.characterID,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        result.errorMsg === "INSUFFICIENT_FUNDS"
          ? "Wallet change failed: insufficient funds."
          : "Wallet change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Adjusted wallet by ${formatIsk(amount)}. New balance: ${formatIsk(result.data.balance)}.`,
    );
  }

  if (command === "setisk") {
    if (!session || !session.characterID) {
      return handledResult(
        chatHub,
        session,
        options,
        "Select a character before changing wallet balance.",
      );
    }

    const amount = parseAmount(argumentText);
    if (amount === null) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /setisk <amount>",
      );
    }

    const result = setCharacterBalance(session.characterID, amount, {
      description: `Admin /setisk by ${session.characterName || session.userName || "unknown"}`,
      ownerID1: session.characterID,
      ownerID2: session.characterID,
      referenceID: session.characterID,
    });
    if (!result.success) {
      return handledResult(
        chatHub,
        session,
        options,
        result.errorMsg === "INSUFFICIENT_FUNDS"
          ? "Wallet change failed: balance cannot be negative."
          : "Wallet change failed.",
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      `Wallet balance set to ${formatIsk(result.data.balance)}.`,
    );
  }

  if (command === "ship" || command === "giveme") {
    return handleShipSpawn(command, session, argumentText, chatHub, options);
  }

  if (command === "load" || command === "fit") {
    return handleLoadLikeCommand(command, session, argumentText, chatHub, options);
  }

  if (command === "hangar") {
    return handledResult(chatHub, session, options, getHangarSummary(session));
  }

  if (command === "session") {
    return handledResult(chatHub, session, options, getSessionSummary(session));
  }

  if (command === "item") {
    return handledResult(chatHub, session, options, getItemSummary(argumentText));
  }

  if (command === "typeinfo") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /typeinfo <ship name>",
      );
    }

    const lookup = resolveShipByName(argumentText);
    if (!lookup.success) {
      const message =
        lookup.errorMsg === "SHIP_NOT_FOUND"
          ? `Ship type not found: ${argumentText}.${formatSuggestions(lookup.suggestions)}`
          : `Ship type name is ambiguous: ${argumentText}.${formatSuggestions(lookup.suggestions)}`;
      return handledResult(chatHub, session, options, message.trim());
    }

    return handledResult(
      chatHub,
      session,
      options,
      `${lookup.match.name}: typeID=${lookup.match.typeID}, groupID=${lookup.match.groupID}, categoryID=${lookup.match.categoryID}.`,
    );
  }

  if (command === "announce") {
    if (!argumentText) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /announce <message>",
      );
    }

    sendAnnouncement(chatHub, session, argumentText);
    return handledResult(
      chatHub,
      session,
      options,
      `Announcement sent: ${argumentText}`,
    );
  }

  if (command === "tr") {
    const parts = argumentText ? argumentText.split(/\s+/).filter(Boolean) : [];
    if (parts.length === 0) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /tr <character|me> <locationID>",
      );
    }

    const targetText = parts.length === 1 ? "me" : parts[0];
    const destinationText = parts.length === 1 ? parts[0] : parts.slice(1).join(" ");
    const targetSession = resolveTeleportTargetSession(session, targetText);

    if (!targetSession) {
      return handledResult(
        chatHub,
        session,
        options,
        `Teleport target not found or not online: ${targetText}.`,
      );
    }

    const destinationID = Number(destinationText);
    if (!Number.isInteger(destinationID) || destinationID <= 0) {
      return handledResult(
        chatHub,
        session,
        options,
        "Usage: /tr <character|me> <locationID>",
      );
    }

    const result = getTeleportSession()(targetSession, destinationID);
    if (!result.success) {
      let message = "Teleport failed.";
      if (result.errorMsg === "CHARACTER_NOT_SELECTED") {
        message = "Teleport failed: no active character selected.";
      } else if (result.errorMsg === "SHIP_NOT_FOUND") {
        message = "Teleport failed: active ship not found.";
      } else if (result.errorMsg === "DESTINATION_NOT_FOUND") {
        message = `Teleport destination not found: ${destinationID}.`;
      }

      return handledResult(chatHub, session, options, message);
    }

    const destinationLabel =
      (result.data && result.data.summary) || `location ${destinationID}`;
    if (chatHub && targetSession !== session) {
      chatHub.sendSystemMessage(
        targetSession,
        `You were teleported to ${destinationLabel}.`,
      );
    }

    return handledResult(
      chatHub,
      session,
      options,
      targetSession === session
        ? `Teleported to ${destinationLabel}.`
        : `Teleported ${targetSession.characterName || targetSession.characterID} to ${destinationLabel}.`,
    );
  }

  return handledResult(
    chatHub,
    session,
    options,
    `Unknown command: /${command}. Use /help.`,
  );
}

module.exports = {
  AVAILABLE_SLASH_COMMANDS,
  COMMANDS_HELP_TEXT,
  DEFAULT_MOTD_MESSAGE,
  executeChatCommand,
};
