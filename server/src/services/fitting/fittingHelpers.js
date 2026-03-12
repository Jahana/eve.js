const path = require("path");

const {
  buildList,
  buildKeyVal,
  extractDictEntries,
  extractList,
  normalizeNumber,
  normalizeText,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeJsonNumber(value, fallback = 0) {
  if (typeof value === "bigint") {
    const numericValue = Number(value);
    return Number.isSafeInteger(numericValue) ? numericValue : fallback;
  }

  const numericValue = normalizeNumber(value, fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function decodeWireValue(value, depth = 0) {
  if (depth > 12) {
    return null;
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    const numericValue = Number(value);
    return Number.isSafeInteger(numericValue) ? numericValue : value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => decodeWireValue(entry, depth + 1));
  }

  if (typeof value !== "object") {
    return value;
  }

  if (value.type === "list") {
    return extractList(value).map((entry) => decodeWireValue(entry, depth + 1));
  }

  if (value.type === "dict") {
    return Object.fromEntries(
      extractDictEntries(value).map(([key, entryValue]) => [
        normalizeText(key, ""),
        decodeWireValue(entryValue, depth + 1),
      ]),
    );
  }

  if (value.type === "object" && value.name === "util.KeyVal") {
    return decodeWireValue(value.args, depth + 1);
  }

  if (value.type === "wstring" || value.type === "token") {
    return normalizeText(value.value, "");
  }

  if (value.type === "bool") {
    return Boolean(normalizeJsonNumber(value.value, 0));
  }

  if (
    value.type === "int" ||
    value.type === "float" ||
    value.type === "double" ||
    value.type === "long"
  ) {
    return normalizeJsonNumber(value.value, 0);
  }

  if (value.type === "substream" || value.type === "substruct") {
    return decodeWireValue(value.value, depth + 1);
  }

  const decoded = {};
  for (const [key, entryValue] of Object.entries(value)) {
    decoded[key] = decodeWireValue(entryValue, depth + 1);
  }
  return decoded;
}

function encodeWireValue(value, depth = 0) {
  if (depth > 12 || value === undefined) {
    return null;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return buildList(value.map((entry) => encodeWireValue(entry, depth + 1)));
  }

  if (typeof value === "object") {
    if (value.type && Object.prototype.hasOwnProperty.call(value, "value")) {
      return value;
    }

    if (
      value.type === "list" ||
      value.type === "dict" ||
      (value.type === "object" && value.name)
    ) {
      return value;
    }

    return buildKeyVal(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        encodeWireValue(entryValue, depth + 1),
      ]),
    );
  }

  return normalizeText(value, "");
}

function summarizeValue(value, depth = 0) {
  if (depth > 4) {
    return "<max-depth>";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return `<Buffer:${value.toString("utf8")}>`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => summarizeValue(entry, depth + 1));
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

function isStructuredPayload(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return true;
  }

  return (
    value.type === "dict" ||
    value.type === "list" ||
    value.type === "object" ||
    value.type === "substream" ||
    value.type === "substruct"
  );
}

function extractPayloadArg(args = []) {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const candidate = args[index];
    if (isStructuredPayload(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractPayloadList(args = []) {
  const rawPayload = extractPayloadArg(args);
  const decodedPayload = decodeWireValue(rawPayload);

  if (Array.isArray(decodedPayload)) {
    return decodedPayload;
  }

  if (
    decodedPayload &&
    typeof decodedPayload === "object" &&
    !Array.isArray(decodedPayload)
  ) {
    if (Array.isArray(decodedPayload.fittings)) {
      return decodedPayload.fittings;
    }

    const values = Object.values(decodedPayload);
    if (
      values.length > 0 &&
      values.every(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
      )
    ) {
      return values;
    }

    return [decodedPayload];
  }

  return [];
}

function extractPositiveIntegers(args = []) {
  return args
    .map((entry) => normalizeJsonNumber(entry, NaN))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
}

function extractTextArgs(args = []) {
  return args
    .map((entry) => {
      if (typeof entry === "string" || Buffer.isBuffer(entry)) {
        return normalizeText(entry, "");
      }

      if (
        entry &&
        typeof entry === "object" &&
        (entry.type === "wstring" || entry.type === "token")
      ) {
        return normalizeText(entry, "");
      }

      return null;
    })
    .filter((entry) => entry !== null);
}

function resolveFittingId(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const candidates = [
      value.fittingID,
      value.fitID,
      value.id,
      value.fittingId,
    ];
    for (const candidate of candidates) {
      const numericValue = normalizeJsonNumber(candidate, 0);
      if (Number.isInteger(numericValue) && numericValue > 0) {
        return numericValue;
      }
    }
  }

  const numericValue = normalizeJsonNumber(value, 0);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function normalizeSavedFitting(rawValue, ownerID, fallbackFittingID = 0) {
  const decodedValue = decodeWireValue(rawValue);
  if (
    !decodedValue ||
    typeof decodedValue !== "object" ||
    Array.isArray(decodedValue)
  ) {
    return {
      success: false,
      errorMsg: "INVALID_FITTING_PAYLOAD",
      data: null,
    };
  }

  const fittingID = resolveFittingId(decodedValue) || fallbackFittingID;
  const normalized = cloneValue(decodedValue);

  normalized.fittingID = fittingID;
  normalized.ownerID = ownerID;
  normalized.name = normalizeText(normalized.name, "");
  normalized.description = normalizeText(normalized.description, "");

  return {
    success: true,
    data: normalized,
  };
}

module.exports = {
  decodeWireValue,
  encodeWireValue,
  summarizeValue,
  extractPayloadArg,
  extractPayloadList,
  extractPositiveIntegers,
  extractTextArgs,
  resolveFittingId,
  normalizeSavedFitting,
};
