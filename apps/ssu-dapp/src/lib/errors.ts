/**
 * Move abort error code decoder for StorageUnit and related modules.
 *
 * Maps common Move abort codes to human-readable messages based on
 * the world-contracts error tables from docs/world-contracts-reference.md.
 */

/** Error tables for known modules */
const STORAGE_UNIT_ERRORS: Record<number, string> = {
	0: "Type ID is empty",
	1: "Item ID is empty",
	2: "Storage unit already exists",
	3: "Storage unit is not online",
	4: "Storage unit is not offline",
	5: "Extension already configured",
	6: "No extension configured",
	7: "Extension type mismatch",
	8: "Network node mismatch",
	9: "Not authorized",
	10: "Metadata not set",
	11: "Storage unit has energy source",
};

const INVENTORY_ERRORS: Record<number, string> = {
	0: "Type ID cannot be empty",
	1: "Invalid inventory capacity",
	2: "Insufficient capacity -- not enough space in the inventory",
	3: "Item not found in inventory",
	4: "Insufficient quantity -- not enough items to withdraw",
	6: "Type ID mismatch for join operation",
	7: "Invalid split quantity",
};

const CHARACTER_ERRORS: Record<number, string> = {
	0: "Game character ID is empty",
	1: "Tribe ID is empty",
	2: "Character already exists",
	3: "Tenant name cannot be empty",
	4: "Address cannot be empty",
	5: "Sender cannot access character -- wallet does not own this character",
	6: "Metadata not set on character",
	7: "Character access not authorized",
};

const ACCESS_ERRORS: Record<number, string> = {
	0: "Unauthorized sponsor",
	1: "OwnerCap does not match the expected ID",
	2: "Return address does not match the expected address",
};

const EXCHANGE_ERRORS: Record<number, string> = {
	0: "Invalid fee -- basis points out of range",
	1: "Order not found",
	2: "Insufficient coin balance for order",
	3: "Not the order owner",
	4: "Invalid price -- must be greater than zero",
	5: "Invalid amount -- must be greater than zero",
	6: "Order book is empty",
};

/**
 * Try to decode a Move abort error message into something human-readable.
 *
 * Abort errors typically contain patterns like:
 * - "MoveAbort(..., 4)" or "abort_code: 4"
 * - Module paths like "storage_unit", "inventory", "character", "access"
 */
export function decodeErrorMessage(errorStr: string): string {
	// Try to extract the abort code from error message
	const abortMatch = errorStr.match(/MoveAbort\([^)]*?,\s*(\d+)\)/i);
	const abortCodeMatch = errorStr.match(/abort_code:\s*(\d+)/i);
	const code = abortMatch?.[1] ?? abortCodeMatch?.[1];

	if (!code) return errorStr;

	const numCode = Number(code);

	// Try to identify which module the error is from
	const lowerErr = errorStr.toLowerCase();

	if (lowerErr.includes("inventory")) {
		const msg = INVENTORY_ERRORS[numCode];
		if (msg) return `Inventory error: ${msg} (code ${numCode})`;
	}

	if (lowerErr.includes("storage_unit")) {
		const msg = STORAGE_UNIT_ERRORS[numCode];
		if (msg) return `Storage unit error: ${msg} (code ${numCode})`;
	}

	if (lowerErr.includes("character")) {
		const msg = CHARACTER_ERRORS[numCode];
		if (msg) return `Character error: ${msg} (code ${numCode})`;
	}

	if (lowerErr.includes("access")) {
		const msg = ACCESS_ERRORS[numCode];
		if (msg) return `Access error: ${msg} (code ${numCode})`;
	}

	if (lowerErr.includes("exchange")) {
		const msg = EXCHANGE_ERRORS[numCode];
		if (msg) return `Exchange error: ${msg} (code ${numCode})`;
	}

	// If we found a code but can't identify the module, try all tables
	for (const [label, table] of [
		["Inventory", INVENTORY_ERRORS],
		["Storage unit", STORAGE_UNIT_ERRORS],
		["Character", CHARACTER_ERRORS],
		["Access", ACCESS_ERRORS],
		["Exchange", EXCHANGE_ERRORS],
	] as const) {
		const msg = table[numCode];
		if (msg) return `${label} error: ${msg} (code ${numCode})`;
	}

	return `Move abort code ${numCode}: ${errorStr}`;
}
