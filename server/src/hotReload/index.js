const fs = require("fs");
const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));

const HOT_RELOADABLE_SERVICE_SUFFIX = "Service.js";
const HOT_RELOADABLE_SECONDARY_FILES = new Set([
  "_secondary/express/publicGatewayLocal.js",
]);
const PROTECTED_RELATIVE_PATHS = new Set([
  "config/index.js",
  "network/clientSession.js",
  "network/packetDispatcher.js",
  "network/tcp/handshake.js",
  "network/tcp/index.js",
  "services/baseService.js",
  "services/chat/chatHub.js",
  "services/chat/sessionRegistry.js",
  "services/chat/xmppStubServer.js",
  "services/serviceManager.js",
  "space/runtime.js",
  "_secondary/charOffliner/server.js",
  "_secondary/chat/xmppStubService.js",
  "_secondary/express/server.js",
  "_secondary/image/server.js",
  "_secondary/launcher/server.js",
]);

let activeController = null;

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isSubPath(absPath, absRoot) {
  const relativePath = path.relative(absRoot, absPath);
  return (
    relativePath !== "" &&
    relativePath !== "." &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

function walkServiceFiles(dir, collected = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkServiceFiles(fullPath, collected);
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(HOT_RELOADABLE_SERVICE_SUFFIX) &&
      entry.name !== "baseService.js" &&
      entry.name !== "serviceManager.js"
    ) {
      collected.push(fullPath);
    }
  }

  return collected;
}

function instantiateServices(servicesDir) {
  const serviceInstances = [];

  for (const fullPath of walkServiceFiles(servicesDir)) {
    try {
      const exported = require(fullPath);
      if (typeof exported === "function") {
        serviceInstances.push(new exported());
        continue;
      }

      if (exported && typeof exported === "object") {
        for (const value of Object.values(exported)) {
          if (typeof value === "function") {
            serviceInstances.push(new value());
          }
        }
      }
    } catch (error) {
      log.err(`[HotReload] Failed to load service ${fullPath}: ${error.message}`);
      throw error;
    }
  }

  return serviceInstances;
}

class HotReloadController {
  constructor({
    serviceManager,
    projectRoot,
    srcRoot,
    servicesDir,
    watchEnabled = true,
    debounceMs = 750,
    getConnectedSessionCount = null,
    onIdleRestartRequested = null,
  }) {
    this.serviceManager = serviceManager;
    this.projectRoot = projectRoot;
    this.srcRoot = srcRoot;
    this.servicesDir = servicesDir;
    this.watchEnabled = watchEnabled !== false;
    this.debounceMs = Number(debounceMs) > 0 ? Number(debounceMs) : 750;
    this.getConnectedSessionCount =
      typeof getConnectedSessionCount === "function"
        ? getConnectedSessionCount
        : () => 0;
    this.onIdleRestartRequested =
      typeof onIdleRestartRequested === "function"
        ? onIdleRestartRequested
        : null;
    this.watcher = null;
    this.pendingFiles = new Set();
    this.pendingRestartFiles = new Set();
    this.pendingTimer = null;
    this.reloadCount = 0;
    this.lastReloadAt = null;
    this.lastResult = null;
    this.restartRequested = false;
  }

  getRelativeProjectPath(absPath) {
    return normalizePath(path.relative(this.projectRoot, absPath));
  }

  getRelativeSourcePath(absPath) {
    return normalizePath(path.relative(this.srcRoot, absPath));
  }

  isSupportedSourceFile(absPath) {
    if (!absPath || !absPath.endsWith(".js") || !isSubPath(absPath, this.srcRoot)) {
      return false;
    }

    const relativePath = this.getRelativeSourcePath(absPath);
    if (PROTECTED_RELATIVE_PATHS.has(relativePath)) {
      return false;
    }

    if (relativePath.startsWith("services/")) {
      return true;
    }

    if (relativePath.startsWith("space/") && relativePath !== "space/runtime.js") {
      return true;
    }

    if (HOT_RELOADABLE_SECONDARY_FILES.has(relativePath)) {
      return true;
    }

    return false;
  }

  describeSupport(absPath) {
    if (!absPath || !absPath.endsWith(".js") || !isSubPath(absPath, this.srcRoot)) {
      return "outside hot reload scope";
    }

    const relativePath = this.getRelativeSourcePath(absPath);
    if (PROTECTED_RELATIVE_PATHS.has(relativePath)) {
      return "requires restart";
    }

    return this.isSupportedSourceFile(absPath) ? "reloadable" : "ignored";
  }

  clearReloadableModuleCache() {
    const cleared = [];
    const skipped = [];

    for (const modulePath of Object.keys(require.cache)) {
      if (!this.isSupportedSourceFile(modulePath)) {
        if (modulePath.endsWith(".js") && isSubPath(modulePath, this.srcRoot)) {
          skipped.push(this.getRelativeSourcePath(modulePath));
        }
        continue;
      }

      delete require.cache[modulePath];
      cleared.push(this.getRelativeSourcePath(modulePath));
    }

    return {
      cleared,
      skipped,
    };
  }

  reloadNow(reason = "manual", changedFiles = []) {
    const absoluteChangedFiles = [...new Set(changedFiles.filter(Boolean).map((entry) => path.resolve(entry)))];
    const supportedFiles = absoluteChangedFiles.filter((entry) => this.isSupportedSourceFile(entry));
    const restartRequiredFiles = absoluteChangedFiles.filter(
      (entry) =>
        entry.endsWith(".js") &&
        isSubPath(entry, this.srcRoot) &&
        !this.isSupportedSourceFile(entry) &&
        this.describeSupport(entry) === "requires restart",
    );

    try {
      const cacheResult = this.clearReloadableModuleCache();
      const nextServices = instantiateServices(this.servicesDir);
      this.serviceManager.rebuild(nextServices);

      this.reloadCount += 1;
      this.lastReloadAt = new Date().toISOString();
      this.lastResult = {
        success: true,
        reason,
        changedFiles: absoluteChangedFiles.map((entry) => this.getRelativeProjectPath(entry)),
        reloadedFiles: supportedFiles.map((entry) => this.getRelativeProjectPath(entry)),
        restartRequiredFiles: restartRequiredFiles.map((entry) =>
          this.getRelativeProjectPath(entry),
        ),
        clearedModuleCount: cacheResult.cleared.length,
        serviceCount: this.serviceManager.count,
        at: this.lastReloadAt,
      };

      log.info(
        `[HotReload] Reloaded ${this.serviceManager.count} services reason=${reason} changed=${absoluteChangedFiles.length} clearedModules=${cacheResult.cleared.length}`,
      );
      if (restartRequiredFiles.length > 0) {
        log.warn(
          `[HotReload] Some changed files still require a full restart: ${restartRequiredFiles
            .map((entry) => this.getRelativeProjectPath(entry))
            .join(", ")}`,
        );
        this.markRestartRequired(restartRequiredFiles, reason);
      }

      return this.lastResult;
    } catch (error) {
      this.lastResult = {
        success: false,
        reason,
        changedFiles: absoluteChangedFiles.map((entry) => this.getRelativeProjectPath(entry)),
        error: error.message,
        at: new Date().toISOString(),
      };
      log.err(`[HotReload] Reload failed: ${error.stack || error.message}`);
      return this.lastResult;
    }
  }

  markRestartRequired(changedFiles = [], reason = "manual") {
    for (const filePath of changedFiles) {
      if (filePath) {
        this.pendingRestartFiles.add(path.resolve(filePath));
      }
    }

    if (this.pendingRestartFiles.size === 0) {
      return false;
    }

    return this.maybeRequestIdleRestart(reason);
  }

  maybeRequestIdleRestart(reason = "manual") {
    if (this.restartRequested || this.pendingRestartFiles.size === 0) {
      return false;
    }

    const connectedSessionCount = Number(this.getConnectedSessionCount()) || 0;
    if (connectedSessionCount > 0) {
      log.info(
        `[HotReload] Restart pending for ${this.pendingRestartFiles.size} file(s); waiting for ${connectedSessionCount} connected user(s) to disconnect`,
      );
      return false;
    }

    if (!this.onIdleRestartRequested) {
      log.warn("[HotReload] Restart is required but no restart handler is configured");
      return false;
    }

    this.restartRequested = true;
    const pendingFiles = [...this.pendingRestartFiles].map((entry) =>
      this.getRelativeProjectPath(entry),
    );
    log.warn(
      `[HotReload] No connected users remain; restarting to apply: ${pendingFiles.join(", ")}`,
    );
    this.onIdleRestartRequested({
      reason,
      pendingRestartFiles: pendingFiles,
    });
    return true;
  }

  handleSessionRegistryChange() {
    this.maybeRequestIdleRestart("idle");
  }

  requestReload(reason = "watch", changedFiles = []) {
    for (const filePath of changedFiles) {
      if (filePath) {
        this.pendingFiles.add(path.resolve(filePath));
      }
    }

    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }

    this.pendingTimer = setTimeout(() => {
      const files = [...this.pendingFiles];
      this.pendingFiles.clear();
      this.pendingTimer = null;
      this.reloadNow(reason, files);
    }, this.debounceMs);
  }

  startWatching() {
    if (!this.watchEnabled || this.watcher) {
      return false;
    }

    this.watcher = fs.watch(
      this.srcRoot,
      { recursive: true },
      (eventType, fileName) => {
        if (!fileName) {
          return;
        }

        const absolutePath = path.join(this.srcRoot, fileName);
        if (!absolutePath.endsWith(".js")) {
          return;
        }

        const support = this.describeSupport(absolutePath);
        if (support === "ignored") {
          return;
        }

        if (support === "requires restart") {
          log.warn(
            `[HotReload] Detected change requiring restart: ${this.getRelativeProjectPath(
              absolutePath,
            )}`,
          );
        }

        this.requestReload(`watch:${eventType}`, [absolutePath]);
      },
    );

    this.watcher.on("error", (error) => {
      log.err(`[HotReload] Watcher error: ${error.message}`);
    });

    log.info(`[HotReload] Watching ${this.srcRoot} for code changes`);
    return true;
  }

  stopWatching() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingFiles.clear();
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  getStatus() {
    return {
      enabled: true,
      watchEnabled: this.watchEnabled,
      watching: Boolean(this.watcher),
      reloadCount: this.reloadCount,
      lastReloadAt: this.lastReloadAt,
      lastResult: this.lastResult,
      restartPending: this.pendingRestartFiles.size > 0,
      restartRequested: this.restartRequested,
      pendingRestartFiles: [...this.pendingRestartFiles].map((entry) =>
        this.getRelativeProjectPath(entry),
      ),
    };
  }
}

function setHotReloadController(controller) {
  activeController = controller || null;
}

function getHotReloadController() {
  return activeController;
}

module.exports = {
  HotReloadController,
  getHotReloadController,
  instantiateServices,
  setHotReloadController,
};
