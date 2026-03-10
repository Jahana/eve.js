const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const {
  ACCOUNT_KEY,
  ACCOUNT_KEY_NAME,
  JOURNAL_ENTRY_TYPE,
  getCharacterWallet,
  getCharacterWalletJournal,
  transferCharacterBalance,
} = require(path.join(__dirname, "./walletState"));

const JOURNAL_HEADERS = [
  "transactionID",
  "transactionDate",
  "referenceID",
  "entryTypeID",
  "ownerID1",
  "ownerID2",
  "accountKey",
  "amount",
  "balance",
  "description",
  "currency",
  "sortValue",
];

function buildList(items) {
  return { type: "list", items };
}

function buildKeyVal(entries) {
  return {
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries,
    },
  };
}

function buildRowset(header, rows) {
  return {
    type: "object",
    name: "util.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", buildList(header)],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", buildList(rows)],
      ],
    },
  };
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (Buffer.isBuffer(value)) {
    return normalizeNumber(value.toString("utf8"), fallback);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  if (typeof value === "object") {
    if (value.type === "wstring" || value.type === "token") {
      return normalizeNumber(value.value, fallback);
    }

    if (value.type === "long" || value.type === "int") {
      return normalizeNumber(value.value, fallback);
    }
  }

  return fallback;
}

function normalizeText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (value.type === "wstring" || value.type === "token") {
      return normalizeText(value.value, fallback);
    }
  }

  return String(value);
}

function extractKwarg(kwargs, key) {
  if (!kwargs || kwargs.type !== "dict" || !Array.isArray(kwargs.entries)) {
    return undefined;
  }

  const match = kwargs.entries.find((entry) => entry[0] === key);
  return match ? match[1] : undefined;
}

function resolveAccountKey(rawValue) {
  const numericValue = normalizeNumber(rawValue, ACCOUNT_KEY.CASH);
  const textValue = normalizeText(rawValue, "").trim().toLowerCase();

  if (numericValue === ACCOUNT_KEY.AURUM || textValue === "aurum" || textValue === "aur") {
    return {
      id: ACCOUNT_KEY.AURUM,
      name: ACCOUNT_KEY_NAME.AURUM,
      field: "aurBalance",
    };
  }

  return {
    id: ACCOUNT_KEY.CASH,
    name: ACCOUNT_KEY_NAME.CASH,
    field: "balance",
  };
}

function buildJournalRowset(entries) {
  const rows = entries.map((entry) =>
    buildList([
      normalizeNumber(entry.transactionID, 0),
      { type: "long", value: BigInt(String(entry.transactionDate || 0)) },
      normalizeNumber(entry.referenceID, 0),
      normalizeNumber(entry.entryTypeID, JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT),
      normalizeNumber(entry.ownerID1, 0),
      normalizeNumber(entry.ownerID2, 0),
      normalizeNumber(entry.accountKey, ACCOUNT_KEY.CASH),
      normalizeNumber(entry.amount, 0),
      normalizeNumber(entry.balance, 0),
      normalizeText(entry.description, ""),
      normalizeNumber(entry.currency, 1),
      normalizeNumber(entry.sortValue, 1),
    ]),
  );

  return buildRowset(JOURNAL_HEADERS, rows);
}

class AccountService extends BaseService {
  constructor() {
    super("account");
  }

  Handle_GetCashBalance(args, session, kwargs) {
    const isCorpWallet =
      normalizeNumber(extractKwarg(kwargs, "isCorpWallet"), NaN) ||
      normalizeNumber(args && args[0], 0);
    if (isCorpWallet) {
      return 0.0;
    }

    const walletKey = resolveAccountKey(
      extractKwarg(kwargs, "accountKey") ?? (args && args[1]),
    );
    const wallet = getCharacterWallet(session && session.characterID);
    if (!wallet) {
      return 0.0;
    }

    return wallet[walletKey.field] ?? 0.0;
  }

  Handle_GetKeyMap() {
    return buildList([
      buildKeyVal([
        ["key", ACCOUNT_KEY.CASH],
        ["keyName", ACCOUNT_KEY_NAME.CASH],
        ["name", ACCOUNT_KEY_NAME.CASH],
      ]),
      buildKeyVal([
        ["key", ACCOUNT_KEY.AURUM],
        ["keyName", ACCOUNT_KEY_NAME.AURUM],
        ["name", ACCOUNT_KEY_NAME.AURUM],
      ]),
    ]);
  }

  Handle_GetEntryTypes() {
    return buildList([
      buildKeyVal([
        ["entryTypeID", JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT],
        ["entryTypeName", "AdminAdjustment"],
      ]),
      buildKeyVal([
        ["entryTypeID", JOURNAL_ENTRY_TYPE.PLAYER_DONATION],
        ["entryTypeName", "PlayerDonation"],
      ]),
    ]);
  }

  Handle_GetWalletDivisionsInfo(args, session) {
    const wallet = getCharacterWallet(session && session.characterID);
    return buildList([
      buildKeyVal([
        ["key", ACCOUNT_KEY.CASH],
        ["balance", wallet ? wallet.balance : 0.0],
      ]),
      buildKeyVal([
        ["key", ACCOUNT_KEY.AURUM],
        ["balance", wallet ? wallet.aurBalance : 0.0],
      ]),
    ]);
  }

  Handle_GetAurumBalance(args, session) {
    const wallet = getCharacterWallet(session && session.characterID);
    return wallet ? wallet.aurBalance : 0.0;
  }

  Handle_GetDefaultWalletDivision() {
    return ACCOUNT_KEY.CASH;
  }

  Handle_GetDefaultContactCost() {
    return null;
  }

  Handle_SetContactCost() {
    return null;
  }

  Handle_GetJournal(args, session) {
    return buildJournalRowset(
      getCharacterWalletJournal(session && session.characterID),
    );
  }

  Handle_GetJournalForAccounts(args, session) {
    return buildJournalRowset(
      getCharacterWalletJournal(session && session.characterID),
    );
  }

  Handle_GiveCash(args, session, kwargs) {
    const toID = normalizeNumber(args && args[0], 0);
    const amount = normalizeNumber(args && args[1], 0);
    const reason = normalizeText(
      extractKwarg(kwargs, "reason") ?? (args && args[2]),
      "Player donation",
    );

    if (!session || !session.characterID || !(toID > 0) || !(amount > 0)) {
      return null;
    }

    const result = transferCharacterBalance(session.characterID, toID, amount, {
      description: reason,
    });
    if (!result.success) {
      log.warn(
        `[AccountService] GiveCash failed: ${result.errorMsg} from=${session.characterID} to=${toID} amount=${amount}`,
      );
    }

    return null;
  }
}

module.exports = AccountService;
