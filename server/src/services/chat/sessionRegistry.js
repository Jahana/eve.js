const sessions = new Set();
const listeners = new Set();

function notifyListeners() {
  const snapshot = getSessions();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      // Keep registry updates resilient against observer failures.
    }
  }
}

function register(session) {
  if (session) {
    sessions.add(session);
    notifyListeners();
  }
}

function unregister(session) {
  if (session) {
    sessions.delete(session);
    notifyListeners();
  }
}

function getSessions() {
  return Array.from(sessions).filter(
    (session) => session && session.socket && !session.socket.destroyed,
  );
}

function subscribe(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

module.exports = {
  register,
  unregister,
  getSessions,
  subscribe,
};
