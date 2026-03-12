/**
 * DATABASE CONTROLLER:
 * controls data being read and written to the json db
 */

const path = require("path")
const fs = require("fs")

const log = require("../utils/logger")

const tableCache = new Map()

function getTableDir(table) {
	return path.join(__dirname, "data", table)
}

function getTableDataFile(table) {
	return path.join(getTableDir(table), "data.json")
}

function getTableRevision(table) {
	const dbFile = getTableDataFile(table)
	try {
		if (!fs.existsSync(dbFile)) {
			return 0
		}

		return Number(fs.statSync(dbFile).mtimeMs || 0)
	} catch (error) {
		log.warn(`[DATABASE] failed to stat table '${table}': ${error.message}`)
		return 0
	}
}

function getSegments(pathKey) {
	return String(pathKey || "/").split("/").filter(Boolean)
}

function ensureTableDataFile(table) {
	const tableDir = getTableDir(table)
	if (!fs.existsSync(tableDir)) {
		log.warn(`[DATABASE] database table: '${table}' not found!`)
		return null
	}

	const dbFile = getTableDataFile(table)
	if (!fs.existsSync(dbFile)) {
		fs.writeFileSync(dbFile, "{}", "utf8")
	}

	return dbFile
}

function loadTableData(table, forceReload = false) {
	const dbFile = ensureTableDataFile(table)
	if (!dbFile) {
		return {
			success: false,
			errorMsg: "TABLE_NOT_FOUND",
			data: null
		}
	}

	try {
		const stat = fs.statSync(dbFile)
		const mtimeMs = Number(stat.mtimeMs || 0)
		const cachedEntry = tableCache.get(table)
		if (
			!forceReload &&
			cachedEntry &&
			cachedEntry.mtimeMs === mtimeMs &&
			cachedEntry.data &&
			typeof cachedEntry.data === "object"
		) {
			return {
				success: true,
				errorMsg: null,
				data: cachedEntry.data
			}
		}

		const raw = fs.readFileSync(dbFile, "utf8")
		const parsed = JSON.parse(raw)
		const normalized = parsed && typeof parsed === "object" ? parsed : {}
		tableCache.set(table, {
			mtimeMs,
			data: normalized
		})
		return {
			success: true,
			errorMsg: null,
			data: normalized
		}
	} catch (error) {
		log.error(`[DATABASE] failed to load table '${table}': ${error.message}`)
		return {
			success: false,
			errorMsg: "READ_ERROR",
			data: null
		}
	}
}

function persistTableData(table, data) {
	const dbFile = ensureTableDataFile(table)
	if (!dbFile) {
		return {
			success: false,
			errorMsg: "TABLE_NOT_FOUND"
		}
	}

	try {
		const serialized = JSON.stringify(data, null, 2)
		fs.writeFileSync(dbFile, serialized, "utf8")
		const mtimeMs = getTableRevision(table) || Date.now()
		tableCache.set(table, {
			mtimeMs,
			data
		})
		return {
			success: true,
			errorMsg: null
		}
	} catch (error) {
		log.error(`[DATABASE] failed to persist table '${table}': ${error.message}`)
		return {
			success: false,
			errorMsg: "WRITE_ERROR"
		}
	}
}

function read(table, pth) {
	const loaded = loadTableData(table)
	if (!loaded.success) {
		return loaded
	}

	const db = loaded.data
	const segments = getSegments(pth)
	if (segments.length === 0) {
		return {
			success: true,
			errorMsg: null,
			data: db
		}
	}

	let current = db
	for (const segment of segments) {
		if (
			current === null ||
			typeof current !== "object" ||
			!(segment in current)
		) {
			return {
				success: false,
				errorMsg: "ENTRY_NOT_FOUND",
				data: null
			}
		}
		current = current[segment]
	}

	return {
		success: true,
		errorMsg: null,
		data: current
	}
}

function write(table, pth, data) {
	const loaded = loadTableData(table)
	if (!loaded.success) {
		return {
			success: false,
			errorMsg: loaded.errorMsg || "TABLE_NOT_FOUND"
		}
	}

	const db = loaded.data
	const segments = getSegments(pth)
	if (segments.length === 0) {
		return persistTableData(table, data)
	}

	let current = db
	for (let i = 0; i < segments.length - 1; i += 1) {
		const segment = segments[i]
		if (
			!(segment in current) ||
			current[segment] === null ||
			typeof current[segment] !== "object"
		) {
			current[segment] = {}
		}
		current = current[segment]
	}

	const finalKey = segments[segments.length - 1]
	current[finalKey] = data
	return persistTableData(table, db)
}

function remove(table, pth) {
	const loaded = loadTableData(table)
	if (!loaded.success) {
		return {
			success: false,
			errorMsg: loaded.errorMsg || "TABLE_NOT_FOUND"
		}
	}

	const db = loaded.data
	const segments = getSegments(pth)
	if (segments.length === 0) {
		return {
			success: false,
			errorMsg: "INVALID_PATH"
		}
	}

	let current = db
	for (let i = 0; i < segments.length - 1; i += 1) {
		const segment = segments[i]
		if (
			current === null ||
			typeof current !== "object" ||
			!(segment in current)
		) {
			return {
				success: false,
				errorMsg: "ENTRY_NOT_FOUND"
			}
		}
		current = current[segment]
	}

	const finalKey = segments[segments.length - 1]
	if (
		current === null ||
		typeof current !== "object" ||
		!(finalKey in current)
	) {
		return {
			success: false,
			errorMsg: "ENTRY_NOT_FOUND"
		}
	}

	delete current[finalKey]
	return persistTableData(table, db)
}

function clearCache(table = null) {
	if (table) {
		tableCache.delete(table)
		return
	}
	tableCache.clear()
}

module.exports = {
	read,
	write,
	remove,
	getTableRevision,
	clearCache
}
