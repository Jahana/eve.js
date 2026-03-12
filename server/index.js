/**
 * EVE.js — Main Entry Point
 *
 * Initializes the service manager, registers core game services,
 * and starts the TCP server.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const log = require(path.join(__dirname, "./src/utils/logger"));
const config = require(path.join(__dirname, "./src/config"));

// Service framework
const ServiceManager = require(
  path.join(__dirname, "./src/services/serviceManager"),
);
const {
  HotReloadController,
  instantiateServices,
  setHotReloadController,
} = require(path.join(__dirname, "./src/hotReload"));

// network
const startTCPServer = require(path.join(__dirname, "./src/network/tcp"));
const sessionRegistry = require(path.join(
  __dirname,
  "./src/services/chat/sessionRegistry",
));

// main startup

log.logAsciiLogo();
console.log();
log.info("starting eve.js...");
console.log();

// Display version info
log.debug(`Project: ${config.projectVersion}`);
log.debug(`Client Version: ${config.clientVersion}`);
log.debug(`Client Build: ${config.clientBuild}`);
log.debug(`MachoNet Version: ${config.machoVersion}`);
console.log();

// create and populate service manager
const serviceManager = new ServiceManager();

const servicesDir = path.join(__dirname, "./src/services");
serviceManager.rebuild(instantiateServices(servicesDir));

log.success(`registered ${serviceManager.count} services`);
console.log();

// register secondary services
const secondaryServicesDir = path.join(__dirname, "./src/_secondary");

function loadSecondaryServices(dir) {
  if (!fs.existsSync(dir)) {
    log.debug(`secondary services directory not found: ${dir}`);
    return;
  }

  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      loadSecondaryServices(fullPath);
      continue;
    }

    if (file.isFile() && file.name.endsWith(".js")) {
      try {
        const service = require(fullPath);
        if (service.enabled === true) {
          log.debug(`starting secondary service: ${service.serviceName}`);
          service.exec();
        } else {
          log.debug(
            `skipping service: ${service.serviceName} as it is not enabled`,
          );
        }
        console.log();
      } catch (err) {
        log.err(
          `failed to start secondary service ${fullPath}: ${err.message}`,
        );
        console.log();
      }
    }
  }
}

loadSecondaryServices(secondaryServicesDir);

let restartInProgress = false;
let tcpServer = null;
const RESTART_EXIT_CODE = Number.parseInt(
  process.env.EVEJS_SERVER_RESTART_CODE || "75",
  10,
);
const USE_LAUNCHER_SUPERVISED_RESTART =
  process.env.EVEJS_FOREGROUND_RESTART === "1";

function buildRestartCommand() {
  return {
    command: process.execPath,
    args: [...process.execArgv, path.join(__dirname, "index.js")],
    cwd: __dirname,
  };
}

function spawnForegroundRestart(onReady) {
  const restartCommand = buildRestartCommand();
  const child = spawn(restartCommand.command, restartCommand.args, {
    cwd: restartCommand.cwd,
    env: process.env,
    detached: false,
    stdio: "inherit",
    windowsHide: false,
  });

  let settled = false;
  child.once("error", (error) => {
    if (settled) {
      return;
    }

    settled = true;
    log.err(`[HotReload] Failed to spawn foreground restart: ${error.message}`);
    restartInProgress = false;
  });
  child.once("spawn", () => {
    if (settled) {
      return;
    }

    settled = true;
    if (typeof onReady === "function") {
      onReady();
    }
  });
}

function requestProcessRestart(details = {}) {
  if (restartInProgress) {
    return false;
  }

  restartInProgress = true;
  const pendingFiles = Array.isArray(details.pendingRestartFiles)
    ? details.pendingRestartFiles
    : [];
  const reason = details.reason || "unknown";
  const pendingText =
    pendingFiles.length > 0 ? ` files=${pendingFiles.join(", ")}` : "";
  log.warn(`[HotReload] Auto-restarting server reason=${reason}.${pendingText}`);

  const finalizeRestart = () => {
    if (USE_LAUNCHER_SUPERVISED_RESTART) {
      const hotReloadController = require(path.join(
        __dirname,
        "./src/hotReload",
      )).getHotReloadController();
      if (hotReloadController && typeof hotReloadController.stopWatching === "function") {
        hotReloadController.stopWatching();
      }
      log.warn(
        `[HotReload] Exiting with restart code ${RESTART_EXIT_CODE} for launcher-supervised restart`,
      );
      setTimeout(() => {
        process.exit(RESTART_EXIT_CODE);
      }, 100);
      return;
    }

    spawnForegroundRestart(() => {
      setTimeout(() => {
        process.exit(0);
      }, 100);
    });
  };

  if (tcpServer && typeof tcpServer.close === "function") {
    let finalized = false;
    const complete = () => {
      if (finalized) {
        return;
      }

      finalized = true;
      finalizeRestart();
    };

    tcpServer.close((error) => {
      if (error) {
        log.warn(`[HotReload] TCP server close failed during restart: ${error.message}`);
      }
      complete();
    });

    setTimeout(complete, 2000);
    return true;
  }

  finalizeRestart();
  return true;
}

if (config.hotReloadEnabled) {
  const hotReloadController = new HotReloadController({
    serviceManager,
    projectRoot: __dirname,
    srcRoot: path.join(__dirname, "./src"),
    servicesDir,
    watchEnabled: config.hotReloadWatch !== false,
    debounceMs: config.hotReloadDebounceMs,
    getConnectedSessionCount: () => sessionRegistry.getSessions().length,
    onIdleRestartRequested: requestProcessRestart,
  });
  setHotReloadController(hotReloadController);
  sessionRegistry.subscribe(() => {
    hotReloadController.handleSessionRegistryChange();
  });

  if (config.hotReloadWatch !== false) {
    hotReloadController.startWatching();
  } else {
    log.info("[HotReload] Enabled without automatic file watching");
  }
} else {
  setHotReloadController(null);
}

// Start the TCP server with the service manager
tcpServer = startTCPServer(serviceManager);
