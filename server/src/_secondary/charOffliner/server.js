const fs = require("fs");
const path = require("path");
const config = require("../../config");
const log = require("../../utils/logger");
const database = require("../../database");

function offlineCharacters() {
  const charactersResult = database.read("characters", "/");
  if (!charactersResult.success) {
    log.warn("[charOffliner] Failed to read characters database.");
    return;
  }

  const characters = charactersResult.data;

  for (const character of Object.values(characters)) {
    if (!character) continue;
    character.online = false;
  }

  database.write("characters", "/", characters);
}

module.exports = {
  enabled: true,
  serviceName: "charOffliner",
  exec() {
    offlineCharacters();
    log.debug("all characters have been marked as offline.");
  },
};