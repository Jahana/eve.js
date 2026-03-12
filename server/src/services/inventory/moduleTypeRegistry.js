const path = require("path");

const database = require(path.join(__dirname, "../../database"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));

const MODULE_CATEGORY_ID = 7;
const ROMAN_NUMERAL_TO_DIGIT = Object.freeze({
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
});

let cachedRegistry = null;
let cachedRegistryRevision = 0;

const MODULE_NAME_HINTS = Object.freeze([
  Object.freeze({
    needle: "microwarpdrive",
    slotFamily: "medium",
    defaults: Object.freeze({
      activationDurationMs: 10000,
      maxVelocityBonusPercent: 500,
      primaryEffectName: "modulebonusmicrowarpdrive",
    }),
  }),
  Object.freeze({ needle: "afterburner", slotFamily: "medium" }),
  Object.freeze({ needle: "warp scrambler", slotFamily: "medium" }),
  Object.freeze({ needle: "warp disruptor", slotFamily: "medium" }),
  Object.freeze({ needle: "stasis webifier", slotFamily: "medium" }),
  Object.freeze({ needle: "shield", slotFamily: "medium" }),
  Object.freeze({ needle: "armor", slotFamily: "low" }),
  Object.freeze({ needle: "reactor control", slotFamily: "low" }),
  Object.freeze({ needle: "damage control", slotFamily: "low" }),
  Object.freeze({ needle: "magnetic field", slotFamily: "low" }),
  Object.freeze({ needle: "gyrostabilizer", slotFamily: "low" }),
  Object.freeze({ needle: "heat sink", slotFamily: "low" }),
  Object.freeze({ needle: "ballistic control", slotFamily: "low" }),
  Object.freeze({ needle: "launcher", slotFamily: "high" }),
  Object.freeze({ needle: "turret", slotFamily: "high" }),
  Object.freeze({ needle: "blaster", slotFamily: "high" }),
  Object.freeze({ needle: "railgun", slotFamily: "high" }),
  Object.freeze({ needle: "autocannon", slotFamily: "high" }),
  Object.freeze({ needle: "artillery", slotFamily: "high" }),
  Object.freeze({ needle: "laser", slotFamily: "high" }),
  Object.freeze({ needle: "rig", slotFamily: "rig" }),
]);

function normalizeTypeId(rawValue) {
  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : 0;
}

function normalizeModuleName(value) {
  const tokens = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ROMAN_NUMERAL_TO_DIGIT[token] || token);

  return tokens.join(" ");
}

function getModuleTypesRevision() {
  return typeof database.getTableRevision === "function"
    ? database.getTableRevision(TABLE.MODULE_TYPES)
    : 0;
}

function normalizeEntry(entry) {
  const normalizedEntry = {
    ...entry,
    typeID: normalizeTypeId(entry.typeID),
    groupID: normalizeTypeId(entry.groupID),
    categoryID: normalizeTypeId(entry.categoryID || MODULE_CATEGORY_ID),
    name: String(entry.name || "").trim(),
    slotFamily: String(entry.slotFamily || "").trim(),
    cpuUsage: entry.cpuUsage === null ? null : Number(entry.cpuUsage),
    powerUsage: entry.powerUsage === null ? null : Number(entry.powerUsage),
    activationDurationMs:
      entry.activationDurationMs === null || entry.activationDurationMs === undefined
        ? null
        : Number(entry.activationDurationMs),
    maxVelocityBonusPercent:
      entry.maxVelocityBonusPercent === null ||
      entry.maxVelocityBonusPercent === undefined
        ? null
        : Number(entry.maxVelocityBonusPercent),
    primaryEffectName:
      entry.primaryEffectName === null || entry.primaryEffectName === undefined
        ? ""
        : String(entry.primaryEffectName).trim().toLowerCase(),
  };

  const lowerName = normalizedEntry.name.toLowerCase();
  const nameHint = MODULE_NAME_HINTS.find((hint) => lowerName.includes(hint.needle));
  if (!nameHint) {
    return normalizedEntry;
  }

  const defaults = nameHint.defaults || {};
  const defaultDurationMs = Number(defaults.activationDurationMs);
  const defaultVelocityBonusPercent = Number(defaults.maxVelocityBonusPercent);
  const hasNormalizedDurationMs =
    normalizedEntry.activationDurationMs !== null &&
    normalizedEntry.activationDurationMs !== undefined &&
    Number.isFinite(Number(normalizedEntry.activationDurationMs));
  const hasNormalizedVelocityBonusPercent =
    normalizedEntry.maxVelocityBonusPercent !== null &&
    normalizedEntry.maxVelocityBonusPercent !== undefined &&
    Number.isFinite(Number(normalizedEntry.maxVelocityBonusPercent));
  const normalizedDurationMs = hasNormalizedDurationMs
    ? Number(normalizedEntry.activationDurationMs)
    : null;
  const normalizedVelocityBonusPercent = hasNormalizedVelocityBonusPercent
    ? Number(normalizedEntry.maxVelocityBonusPercent)
    : null;
  return {
    ...normalizedEntry,
    slotFamily: normalizedEntry.slotFamily || nameHint.slotFamily,
    activationDurationMs:
      Number.isFinite(normalizedDurationMs) && normalizedDurationMs > 0
        ? normalizedDurationMs
        : Number.isFinite(defaultDurationMs) && defaultDurationMs > 0
          ? defaultDurationMs
          : null,
    maxVelocityBonusPercent: Number.isFinite(normalizedVelocityBonusPercent)
      ? normalizedVelocityBonusPercent
      : Number.isFinite(defaultVelocityBonusPercent)
        ? defaultVelocityBonusPercent
        : null,
    primaryEffectName:
      normalizedEntry.primaryEffectName || String(defaults.primaryEffectName || ""),
  };
}

function loadDbRegistry() {
  try {
    const modules = readStaticRows(TABLE.MODULE_TYPES);
    if (!Array.isArray(modules) || modules.length === 0) {
      return null;
    }

    const registry = new Map();
    for (const entry of modules) {
      const normalizedEntry = normalizeEntry(entry);
      if (
        normalizedEntry.typeID <= 0 ||
        normalizedEntry.groupID <= 0 ||
        normalizedEntry.categoryID !== MODULE_CATEGORY_ID ||
        !normalizedEntry.name ||
        !normalizedEntry.slotFamily
      ) {
        continue;
      }

      registry.set(normalizedEntry.typeID, normalizedEntry);
    }

    return registry.size > 0 ? registry : null;
  } catch (error) {
    log.warn(
      `[ModuleRegistry] Failed to load module reference data from database: ${error.message}`,
    );
    return null;
  }
}

function loadRegistry() {
  const currentRevision = getModuleTypesRevision();
  if (cachedRegistry && cachedRegistryRevision === currentRevision) {
    return cachedRegistry;
  }

  cachedRegistry = loadDbRegistry() || new Map();
  cachedRegistryRevision = currentRevision;
  return cachedRegistry;
}

function dedupeEntries(entries) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    if (!entry || !entry.typeID) {
      continue;
    }

    const key = `${entry.typeID}:${entry.name || ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function resolveModuleByTypeID(typeID) {
  const numericTypeID = normalizeTypeId(typeID);
  if (numericTypeID <= 0) {
    return null;
  }

  return loadRegistry().get(numericTypeID) || null;
}

function resolveModuleByName(query) {
  const normalizedQuery = normalizeModuleName(query);
  if (!normalizedQuery) {
    return {
      success: false,
      errorMsg: "MODULE_NAME_REQUIRED",
      suggestions: [],
    };
  }

  const exactMatches = [];
  const partialMatches = [];
  for (const entry of loadRegistry().values()) {
    const normalizedEntryName = normalizeModuleName(entry.name);
    if (!normalizedEntryName) {
      continue;
    }

    if (normalizedEntryName === normalizedQuery) {
      exactMatches.push(entry);
      continue;
    }

    if (normalizedEntryName.includes(normalizedQuery)) {
      partialMatches.push(entry);
    }
  }

  const uniqueExact = dedupeEntries(exactMatches);
  if (uniqueExact.length === 1) {
    return {
      success: true,
      match: uniqueExact[0],
      suggestions: [],
    };
  }
  if (uniqueExact.length > 1) {
    return {
      success: false,
      errorMsg: "AMBIGUOUS_MODULE_NAME",
      suggestions: uniqueExact.slice(0, 5).map((entry) => entry.name),
    };
  }

  const uniquePartial = dedupeEntries(partialMatches);
  if (uniquePartial.length === 1) {
    return {
      success: true,
      match: uniquePartial[0],
      suggestions: [],
    };
  }

  return {
    success: false,
    errorMsg:
      uniquePartial.length > 1 ? "AMBIGUOUS_MODULE_NAME" : "MODULE_NOT_FOUND",
    suggestions: uniquePartial.slice(0, 5).map((entry) => entry.name),
  };
}

function resolveModuleType(typeID, itemName = "") {
  const byTypeID = resolveModuleByTypeID(typeID);
  if (byTypeID) {
    return byTypeID;
  }

  const numericTypeID = normalizeTypeId(typeID);
  const normalizedName = String(itemName || "").trim();
  if (normalizedName === "") {
    return null;
  }

  const lowerName = normalizedName.toLowerCase();
  const nameHint = MODULE_NAME_HINTS.find((entry) => lowerName.includes(entry.needle));
  if (!nameHint) {
    return null;
  }

  return {
    typeID: numericTypeID,
    name: normalizedName,
    groupID: 0,
    categoryID: MODULE_CATEGORY_ID,
    slotFamily: nameHint.slotFamily,
    ...(nameHint.defaults || {}),
  };
}

module.exports = {
  MODULE_CATEGORY_ID,
  resolveModuleByTypeID,
  resolveModuleByName,
  resolveModuleType,
};
