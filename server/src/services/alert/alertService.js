/**
 * Alert Service
 *
 * Handles client alert calls like crash reports (BeanCount).
 */

const path = require("path");
const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));

function decodeAlertValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (
      value.type === "wstring" ||
      value.type === "string" ||
      value.type === "token"
    ) {
      return decodeAlertValue(value.value);
    }

    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return decodeAlertValue(value.value);
    }
  }

  return String(value);
}

class AlertService extends BaseService {
  constructor() {
    super("alert");
  }

  Handle_BeanCount(args, session) {
    log.debug("[AlertService] BeanCount (crash report)");
    // Client unpacks: (nextErrorKeyHash, nodeID) = result
    return [null, null];
  }

  Handle_SendClientStackTraceAlert(args, session) {
    const payload = Array.isArray(args) && args.length > 0 ? args[0] : null;
    const alertMessage =
      Array.isArray(payload) && payload.length > 1 ? decodeAlertValue(payload[1]) : "";
    const trimmedMessage = alertMessage.length > 1200
      ? `${alertMessage.slice(0, 1200)}...`
      : alertMessage;

    if (trimmedMessage) {
      log.warn(`[AlertService] Client stack trace:\n${trimmedMessage}`);
    } else {
      log.debug("[AlertService] SendClientStackTraceAlert (error report)");
    }
    return null;
  }
}

module.exports = AlertService;
