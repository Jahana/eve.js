const onlineByItemID = new Map();

function normalizeItemID(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : 0;
}

function isModuleOnline(itemID, fallback = false) {
  const numericItemID = normalizeItemID(itemID);
  if (numericItemID <= 0) {
    return false;
  }

  if (onlineByItemID.has(numericItemID)) {
    return Boolean(onlineByItemID.get(numericItemID));
  }

  return Boolean(fallback);
}

function setModuleOnline(itemID, online = true) {
  const numericItemID = normalizeItemID(itemID);
  if (numericItemID <= 0) {
    return false;
  }

  onlineByItemID.set(numericItemID, Boolean(online));
  return true;
}

module.exports = {
  isModuleOnline,
  setModuleOnline,
};
