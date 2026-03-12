const fs = require("fs");
const path = require("path");

const MODULE_CATEGORY_ID = 7;
const SLOT_EFFECTS = Object.freeze({
  11: "low",
  12: "high",
  13: "medium",
  2663: "rig",
});
const ATTRIBUTE_POWERGRID_USAGE = 30;
const ATTRIBUTE_CPU_USAGE = 50;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = value;
    index += 1;
  }
  return args;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function toNullableNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "\\N" ||
    value === "None"
  ) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readCsvLines(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
}

function loadGroupRows(filePath) {
  const lines = readCsvLines(filePath);
  if (lines.length < 2) {
    throw new Error(`Group CSV appears empty: ${filePath}`);
  }

  const rows = new Map();
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const groupID = toNullableNumber(columns[0]);
    const categoryID = toNullableNumber(columns[1]);
    if (!Number.isInteger(groupID) || !Number.isInteger(categoryID)) {
      continue;
    }

    rows.set(groupID, {
      groupID,
      categoryID,
      groupName: columns[2] || "",
      published: toNullableNumber(columns[8]) === 1,
    });
  }

  return rows;
}

function loadSlotFamilies(filePath) {
  const lines = readCsvLines(filePath);
  if (lines.length < 2) {
    throw new Error(`Type effects CSV appears empty: ${filePath}`);
  }

  const slotsByTypeID = new Map();
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const typeID = toNullableNumber(columns[0]);
    const effectID = toNullableNumber(columns[1]);
    const isDefault = toNullableNumber(columns[2]) === 1;
    const slotFamily = SLOT_EFFECTS[effectID];

    if (!Number.isInteger(typeID) || !slotFamily) {
      continue;
    }

    const current = slotsByTypeID.get(typeID);
    if (!current || isDefault) {
      slotsByTypeID.set(typeID, slotFamily);
    }
  }

  return slotsByTypeID;
}

function loadDogmaAttributes(filePath) {
  const lines = readCsvLines(filePath);
  if (lines.length < 2) {
    throw new Error(`Type attributes CSV appears empty: ${filePath}`);
  }

  const attributesByTypeID = new Map();
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const typeID = toNullableNumber(columns[0]);
    const attributeID = toNullableNumber(columns[1]);
    const valueInt = toNullableNumber(columns[2]);
    const valueFloat = toNullableNumber(columns[3]);

    if (!Number.isInteger(typeID) || !Number.isInteger(attributeID)) {
      continue;
    }

    if (
      attributeID !== ATTRIBUTE_POWERGRID_USAGE &&
      attributeID !== ATTRIBUTE_CPU_USAGE
    ) {
      continue;
    }

    if (!attributesByTypeID.has(typeID)) {
      attributesByTypeID.set(typeID, {});
    }

    const value = valueFloat !== null ? valueFloat : valueInt;
    if (value === null) {
      continue;
    }

    const entry = attributesByTypeID.get(typeID);
    if (attributeID === ATTRIBUTE_POWERGRID_USAGE) {
      entry.powerUsage = value;
    }
    if (attributeID === ATTRIBUTE_CPU_USAGE) {
      entry.cpuUsage = value;
    }
  }

  return attributesByTypeID;
}

function loadModuleRows(typesPath, groupsById, slotFamiliesByTypeID, attributesByTypeID) {
  const lines = readCsvLines(typesPath);
  if (lines.length < 2) {
    throw new Error(`Types CSV appears empty: ${typesPath}`);
  }

  const modules = [];
  for (const line of lines.slice(1)) {
    const columns = parseCsvLine(line);
    const typeID = toNullableNumber(columns[0]);
    const groupID = toNullableNumber(columns[1]);
    const name = columns[2] || "";
    const published = toNullableNumber(columns[9]) === 1;

    if (!Number.isInteger(typeID) || !Number.isInteger(groupID) || !name || !published) {
      continue;
    }

    const group = groupsById.get(groupID);
    const slotFamily = slotFamiliesByTypeID.get(typeID);
    if (!group || group.categoryID !== MODULE_CATEGORY_ID || !slotFamily) {
      continue;
    }

    const attributes = attributesByTypeID.get(typeID) || {};
    modules.push({
      typeID,
      groupID,
      categoryID: group.categoryID,
      groupName: group.groupName,
      name,
      slotFamily,
      cpuUsage:
        typeof attributes.cpuUsage === "number" && Number.isFinite(attributes.cpuUsage)
          ? attributes.cpuUsage
          : null,
      powerUsage:
        typeof attributes.powerUsage === "number" && Number.isFinite(attributes.powerUsage)
          ? attributes.powerUsage
          : null,
      marketGroupID: toNullableNumber(columns[10]),
    });
  }

  modules.sort((left, right) => left.name.localeCompare(right.name) || left.typeID - right.typeID);
  return modules;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const invTypesPath = args.invTypes;
  const invGroupsPath = args.invGroups;
  const dgmTypeEffectsPath = args.dgmTypeEffects;
  const dgmTypeAttributesPath = args.dgmTypeAttributes;
  const outputPath = args.output;
  const dumpDate = args["dump-date"] || "unknown";

  if (
    !invTypesPath ||
    !invGroupsPath ||
    !dgmTypeEffectsPath ||
    !dgmTypeAttributesPath ||
    !outputPath
  ) {
    throw new Error(
      "Usage: node scripts/dev/build-module-data.js --invTypes <path> --invGroups <path> --dgmTypeEffects <path> --dgmTypeAttributes <path> --output <path> [--dump-date <YYYY-MM-DD>]",
    );
  }

  const groupsById = loadGroupRows(invGroupsPath);
  const slotFamiliesByTypeID = loadSlotFamilies(dgmTypeEffectsPath);
  const attributesByTypeID = loadDogmaAttributes(dgmTypeAttributesPath);
  const modules = loadModuleRows(
    invTypesPath,
    groupsById,
    slotFamiliesByTypeID,
    attributesByTypeID,
  );
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const payload = {
    source: {
      provider: "Fuzzwork",
      dumpDate,
      generatedAt: new Date().toISOString(),
    },
    count: modules.length,
    modules,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${modules.length} module rows to ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
