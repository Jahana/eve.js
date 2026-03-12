const pc = require("picocolors");
const config = require("../../config");

function getLogLevel() {
  const numericLevel = Number(config && config.logLevel);
  return Number.isFinite(numericLevel) ? numericLevel : 1;
}

function emit(colorize, prefix, args, minimumLevel) {
  if (getLogLevel() < minimumLevel) {
    return;
  }

  if (!args || args.length === 0) {
    return;
  }

  const [first, ...rest] = args;
  const header = colorize(`${prefix} ${String(first)}`);
  if (rest.length === 0) {
    console.log(header);
    return;
  }

  console.log(header, ...rest);
}

function info(...args) {
  emit(pc.blue, "[LOG]:", args, 2);
}

function debug(...args) {
  emit(pc.cyan, "[DBG]:", args, 2);
}

function warn(...args) {
  emit(pc.yellow, "[WRN]:", args, 1);
}

function err(...args) {
  emit(pc.red, "[ERR]:", args, 1);
}

function success(...args) {
  emit(pc.green, "[SUC]:", args, 2);
}

function logAsciiLogo() {
  console.log(
    pc.blue(
      `--------------------------------------------------      

     mmmmmm m    m mmmmmm         "         
     #      "m  m" #            mmm    mmm  
     #mmmmm  #  #  #mmmmm         #   #   " 
     #       "mm"  #        ##    #    """m 
     #mmmmm   ##   #mmmmm   ##    #   "mmm" 
                                  #         
                                ""
--------------------------------------------------`,
    ),
  );
}
module.exports = {
  info,
  debug,
  warn,
  err,
  error: err,
  success,
  logAsciiLogo,
};
