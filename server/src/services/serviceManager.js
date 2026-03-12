/**
 * EVE Service Manager
 *
 * Ported from EVEServiceManager in eve-server.cpp.
 * Registers game services by name and dispatches CALL_REQ to them.
 */

const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));

class ServiceManager {
  constructor() {
    this._services = new Map();
    this._boundObjects = new Map(); // OID string -> service instance
  }

  _copyServiceState(previousService, nextService) {
    if (
      !previousService ||
      !nextService ||
      previousService === nextService ||
      previousService.name !== nextService.name
    ) {
      return;
    }

    if (
      typeof previousService.exportHotReloadState === "function" &&
      typeof nextService.importHotReloadState === "function"
    ) {
      try {
        nextService.importHotReloadState(previousService.exportHotReloadState());
        return;
      } catch (error) {
        log.warn(
          `[ServiceManager] Failed structured state transfer for ${nextService.name}: ${error.message}`,
        );
      }
    }

    for (const key of Object.keys(previousService)) {
      if (key === "_name") {
        continue;
      }

      nextService[key] = previousService[key];
    }
  }

  _rebindServiceReferences(previousService, nextService) {
    if (!previousService || !nextService) {
      return;
    }

    for (const [oid, boundService] of this._boundObjects.entries()) {
      if (boundService === previousService) {
        this._boundObjects.set(oid, nextService);
      }
    }
  }

  /**
   * Register a service instance. The service must have a `name` property.
   * @param {BaseService} service
   */
  register(service) {
    const name = service.name;
    if (!name) {
      throw new Error("service must have a 'name' property!");
    }
    const previousService = this._services.get(name) || null;
    if (this._services.has(name)) {
      log.warn(`service already registered: ${name}`);
    }
    this._copyServiceState(previousService, service);
    this._services.set(name, service);
    this._rebindServiceReferences(previousService, service);
    log.debug(`service registered: ${name}`);
  }

  /**
   * Register a bound object OID string -> service mapping.
   * Called whenever a service creates a bound object via MachoBindObject.
   */
  registerBoundObject(oidString, service) {
    this._boundObjects.set(oidString, service);
    log.debug(`bound object registered: ${oidString} -> ${service.name}`);
  }

  /**
   * Look up a registered service by name, also checking bound object OIDs.
   * @param {string} name
   * @returns {BaseService|null}
   */
  lookup(name) {
    return this._services.get(name) || this._boundObjects.get(name) || null;
  }

  /**
   * Get a list of all registered service names.
   */
  getServiceNames() {
    return Array.from(this._services.keys());
  }

  /**
   * Get the total number of registered services.
   */
  get count() {
    return this._services.size;
  }

  rebuild(services) {
    const nextServices = new Map();

    for (const service of services) {
      if (!service || !service.name) {
        continue;
      }

      const previousService = this._services.get(service.name) || null;
      this._copyServiceState(previousService, service);
      nextServices.set(service.name, service);
    }

    for (const [oid, boundService] of this._boundObjects.entries()) {
      if (!boundService || !boundService.name) {
        this._boundObjects.delete(oid);
        continue;
      }

      const replacement = nextServices.get(boundService.name);
      if (replacement) {
        this._boundObjects.set(oid, replacement);
      } else {
        this._boundObjects.delete(oid);
      }
    }

    this._services = nextServices;
    log.info(`[ServiceManager] Rebuilt service registry with ${this._services.size} services`);
  }
}

module.exports = ServiceManager;
