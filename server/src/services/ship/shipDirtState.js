const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_EPOCH_OFFSET = 116444736000000000n;

const dirtByShipID = new Map();

function normalizeShipID(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : 0;
}

function normalizeFileTime(rawValue) {
  if (typeof rawValue === "bigint") {
    return rawValue > 0n ? rawValue : null;
  }

  if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
    return BigInt(Math.trunc(rawValue));
  }

  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    try {
      const parsed = BigInt(rawValue.trim());
      return parsed > 0n ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  if (Buffer.isBuffer(rawValue)) {
    try {
      const parsed = BigInt(rawValue.toString("utf8").trim());
      return parsed > 0n ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  return null;
}

function buildCurrentFileTime() {
  return BigInt(Date.now()) * FILETIME_TICKS_PER_MS + FILETIME_EPOCH_OFFSET;
}

function getPendingShipDirtTimestamp(shipID, consume = false) {
  const numericShipID = normalizeShipID(shipID);
  if (numericShipID <= 0) {
    return 0n;
  }

  const dirtTimestamp = dirtByShipID.get(numericShipID) || 0n;
  if (consume && dirtTimestamp > 0n) {
    dirtByShipID.delete(numericShipID);
  }

  return dirtTimestamp;
}

function setShipDirtTimestamp(shipID, rawTimestamp = null) {
  const numericShipID = normalizeShipID(shipID);
  if (numericShipID <= 0) {
    return null;
  }

  const dirtTimestamp = normalizeFileTime(rawTimestamp) || buildCurrentFileTime();
  dirtByShipID.set(numericShipID, dirtTimestamp);
  return dirtTimestamp;
}

module.exports = {
  getPendingShipDirtTimestamp,
  setShipDirtTimestamp,
};
