const path = require("path");

const sessionRegistry = require(path.join(
  __dirname,
  "../chat/sessionRegistry",
));
const {
  getCharacterRecord,
  updateCharacterRecord,
} = require(path.join(__dirname, "../character/characterState"));

const ACCOUNT_KEY = {
  CASH: 1000,
  AURUM: 1200,
};
const ACCOUNT_KEY_NAME = {
  CASH: "cash",
  AURUM: "AURUM",
};
const JOURNAL_ENTRY_TYPE = {
  ADMIN_ADJUSTMENT: 1,
  PLAYER_DONATION: 10,
};
const JOURNAL_CURRENCY = {
  ISK: 1,
  AURUM: 2,
};
const DEFAULT_WALLET = {
  balance: 100000.0,
  aurBalance: 0.0,
  balanceChange: 0.0,
};
const MAX_JOURNAL_ENTRIES = 100;

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMoney(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.round(numeric * 100) / 100;
}

function getFileTimeNowString() {
  return (BigInt(Date.now()) * 10000n + 116444736000000000n).toString();
}

function getTransactionID() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function getCharacterWallet(charId) {
  const record = getCharacterRecord(charId);
  if (!record) {
    return null;
  }

  return {
    characterID: Number(charId),
    balance: normalizeMoney(record.balance, DEFAULT_WALLET.balance),
    aurBalance: normalizeMoney(record.aurBalance, DEFAULT_WALLET.aurBalance),
    balanceChange: normalizeMoney(
      record.balanceChange,
      DEFAULT_WALLET.balanceChange,
    ),
  };
}

function getCharacterWalletJournal(charId) {
  const record = getCharacterRecord(charId);
  if (!record || !Array.isArray(record.walletJournal)) {
    return [];
  }

  return record.walletJournal.map((entry) => cloneValue(entry));
}

function appendWalletJournalEntry(record, entry) {
  const nextJournal = Array.isArray(record.walletJournal)
    ? record.walletJournal.map((candidate) => cloneValue(candidate))
    : [];
  nextJournal.unshift(entry);
  record.walletJournal = nextJournal.slice(0, MAX_JOURNAL_ENTRIES);
}

function syncWalletToSession(session, wallet) {
  if (!session || !wallet) {
    return;
  }

  session.balance = wallet.balance;
  session.aurBalance = wallet.aurBalance;
  session.balanceChange = wallet.balanceChange;
}

function emitAccountChangeToSession(session, options = {}) {
  if (!session || typeof session.sendNotification !== "function") {
    return;
  }

  const accountKey = options.accountKey || ACCOUNT_KEY_NAME.CASH;
  const ownerID =
    Number(options.ownerID || session.characterID || session.userid || 0) || 0;
  const balance = normalizeMoney(options.balance, 0);

  session.sendNotification("OnAccountChange", "cash", [
    accountKey,
    ownerID,
    balance,
  ]);
}

function notifyCharacterWalletChange(charId, wallet, options = {}) {
  const sessions = sessionRegistry
    .getSessions()
    .filter(
      (session) => Number(session.characterID || 0) === Number(charId || 0),
    );

  for (const session of sessions) {
    syncWalletToSession(session, wallet);
    emitAccountChangeToSession(session, {
      accountKey: options.accountKey || ACCOUNT_KEY_NAME.CASH,
      ownerID: charId,
      balance:
        options.balance !== undefined && options.balance !== null
          ? options.balance
          : wallet.balance,
    });
  }
}

function setCharacterBalance(charId, nextBalance, options = {}) {
  const currentWallet = getCharacterWallet(charId);
  if (!currentWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const normalizedBalance = normalizeMoney(nextBalance, currentWallet.balance);
  if (normalizedBalance < 0) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  const delta = normalizeMoney(normalizedBalance - currentWallet.balance, 0);
  const journalEntry = {
    transactionID: getTransactionID(),
    transactionDate: getFileTimeNowString(),
    referenceID: Number(options.referenceID || options.ownerID2 || 0) || 0,
    entryTypeID:
      Number(options.entryTypeID || JOURNAL_ENTRY_TYPE.ADMIN_ADJUSTMENT) || 0,
    ownerID1: Number(options.ownerID1 || charId || 0) || 0,
    ownerID2: Number(options.ownerID2 || 0) || 0,
    accountKey: Number(options.accountKey || ACCOUNT_KEY.CASH) || ACCOUNT_KEY.CASH,
    amount: delta,
    balance: normalizedBalance,
    description: String(options.description || "Wallet balance change"),
    currency:
      Number(options.currency || JOURNAL_CURRENCY.ISK) || JOURNAL_CURRENCY.ISK,
    sortValue: 1,
  };

  const writeResult = updateCharacterRecord(charId, (record) => {
    record.balance = normalizedBalance;
    record.balanceChange = delta;
    appendWalletJournalEntry(record, journalEntry);
    return record;
  });

  if (!writeResult.success) {
    return writeResult;
  }

  const updatedWallet = {
    ...currentWallet,
    balance: normalizedBalance,
    balanceChange: delta,
  };
  notifyCharacterWalletChange(charId, updatedWallet, {
    accountKey: options.accountKeyName || ACCOUNT_KEY_NAME.CASH,
    balance: normalizedBalance,
  });

  return {
    success: true,
    data: updatedWallet,
    previousBalance: currentWallet.balance,
    delta,
  };
}

function adjustCharacterBalance(charId, amount, options = {}) {
  const currentWallet = getCharacterWallet(charId);
  if (!currentWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  const delta = normalizeMoney(amount, 0);
  return setCharacterBalance(charId, currentWallet.balance + delta, {
    ...options,
    description:
      options.description ||
      (delta >= 0 ? "Wallet credit" : "Wallet debit"),
  });
}

function transferCharacterBalance(fromCharId, toCharId, amount, options = {}) {
  const normalizedAmount = normalizeMoney(amount, 0);
  if (!(normalizedAmount > 0)) {
    return {
      success: false,
      errorMsg: "AMOUNT_REQUIRED",
    };
  }

  const sourceWallet = getCharacterWallet(fromCharId);
  const targetWallet = getCharacterWallet(toCharId);
  if (!sourceWallet || !targetWallet) {
    return {
      success: false,
      errorMsg: "CHARACTER_NOT_FOUND",
    };
  }

  if (sourceWallet.balance < normalizedAmount) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_FUNDS",
    };
  }

  const description =
    options.description || `Transfer to ${Number(toCharId || 0)}`;
  const debitResult = adjustCharacterBalance(fromCharId, -normalizedAmount, {
    description,
    ownerID1: fromCharId,
    ownerID2: toCharId,
    referenceID: toCharId,
    entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_DONATION,
  });
  if (!debitResult.success) {
    return debitResult;
  }

  const creditResult = adjustCharacterBalance(toCharId, normalizedAmount, {
    description,
    ownerID1: fromCharId,
    ownerID2: toCharId,
    referenceID: fromCharId,
    entryTypeID: JOURNAL_ENTRY_TYPE.PLAYER_DONATION,
  });
  if (!creditResult.success) {
    return creditResult;
  }

  return {
    success: true,
    from: debitResult.data,
    to: creditResult.data,
    amount: normalizedAmount,
  };
}

module.exports = {
  ACCOUNT_KEY,
  ACCOUNT_KEY_NAME,
  JOURNAL_ENTRY_TYPE,
  JOURNAL_CURRENCY,
  getCharacterWallet,
  getCharacterWalletJournal,
  syncWalletToSession,
  emitAccountChangeToSession,
  notifyCharacterWalletChange,
  setCharacterBalance,
  adjustCharacterBalance,
  transferCharacterBalance,
};
