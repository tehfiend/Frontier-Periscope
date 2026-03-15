import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";

// WASM module — needs async init before use
let wasmReady: Promise<void> | null = null;
let updateIdentifiers: typeof import("@mysten/move-bytecode-template").update_identifiers;
let updateConstants: typeof import("@mysten/move-bytecode-template").update_constants;

async function ensureWasmReady(): Promise<void> {
	if (wasmReady) return wasmReady;
	wasmReady = (async () => {
		const mod = await import("@mysten/move-bytecode-template");
		// The web build exports a default init function that loads the WASM
		if (typeof mod.default === "function") {
			await mod.default();
		}
		updateIdentifiers = mod.update_identifiers;
		updateConstants = mod.update_constants;
	})();
	return wasmReady;
}

/**
 * In-browser token creation via bytecode patching.
 *
 * Uses @mysten/move-bytecode-template to safely modify the pre-compiled
 * TOKEN_TEMPLATE module. Identifiers and constants are updated without
 * corrupting the Move bytecode format (ULEB128 lengths, offset tables, etc.).
 *
 * The user signs the publish transaction with their wallet (EVE Vault).
 * No gas station or CLI required.
 */

// Pre-compiled TOKEN_TEMPLATE.mv (691 bytes, from contracts/token_template/build/)
// Module: token_template::TOKEN_TEMPLATE
// Contains: init (creates TreasuryCap + CoinMetadata), mint, burn
const TEMPLATE_BYTECODES_B64 =
	"oRzrCwYAAAAKAQAMAgwkAzA6BGoOBXh0B+wBwgEIrgNgBo4ELQq7BAUMwARFAAMBDgIIAhICEwIUAAMCAAECBwEAAAIADAEAAQIBDAEAAQIEDAEAAQQFAgAFBgcAAAsAAQAADAIBAQAABwMBAQABDQEGAQACBwMRAQACCQgJAQICDA8QAQADDw4BAQwDEA0BAQwEEQoLAAMFBQcIDAcEBg4IEAQOAggABwgFAAQHCwQBCQADBQcIBQIHCwQBCQALAgEJAAELAwEIAAEIBgELAQEJAAEIAAcJAAIKAgoCCgILAQEIBgcIBQILBAEJAAsDAQkAAQYIBQEFAQsEAQgAAgkABQEJAAMHCwQBCQADBwgFAQsCAQkAAQMEQ29pbgxDb2luTWV0YWRhdGEGT3B0aW9uDlRPS0VOX1RFTVBMQVRFC1RyZWFzdXJ5Q2FwCVR4Q29udGV4dANVcmwEYnVybgRjb2luD2NyZWF0ZV9jdXJyZW5jeQtkdW1teV9maWVsZARpbml0BG1pbnQEbm9uZQZvcHRpb24UcHVibGljX2ZyZWV6ZV9vYmplY3QPcHVibGljX3RyYW5zZmVyBnNlbmRlcgh0cmFuc2Zlcgp0eF9jb250ZXh0A3VybAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgoCBQRUTVBMCgIPDlRlbXBsYXRlIFRva2VuCgIQD0EgZmFjdGlvbiB0b2tlbgACAQoBAAAAAAQQCwAxCQcABwEHAjgACgE4AQwCCwEuEQk4AgsCOAMCAQEEAAEHCwALAQsDOAQLAjgFAgIBBAABBQsACwE4BgECAA==";

function getTemplateBytecodes(): Uint8Array {
	const binaryStr = atob(TEMPLATE_BYTECODES_B64);
	const bytes = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) {
		bytes[i] = binaryStr.charCodeAt(i);
	}
	return bytes;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CreateTokenParams {
	/** Token symbol, e.g. "GOLD" */
	symbol: string;
	/** Display name, e.g. "Organization Gold" */
	name: string;
	/** Description */
	description: string;
	/** Decimal places (default 9) */
	decimals?: number;
}

export interface PublishTokenResult {
	packageId: string;
	coinType: string;
	treasuryCapId: string;
	moduleName: string;
}

/**
 * Build a transaction to publish a custom token in-browser.
 *
 * Uses @mysten/move-bytecode-template to safely patch the pre-compiled
 * TOKEN_TEMPLATE module with custom identifiers and metadata constants.
 * The user signs with their wallet — no server needed.
 */
export async function buildPublishToken(params: CreateTokenParams): Promise<Transaction> {
	const { symbol, name, description, decimals = 9 } = params;

	// Ensure WASM module is loaded
	await ensureWasmReady();

	// Derive module name from symbol: "GOLD" → "GOLD_TOKEN"
	const moduleName = `${symbol.toUpperCase()}_TOKEN`;

	let bytecodes = getTemplateBytecodes();

	// 1. Update identifiers: TOKEN_TEMPLATE → GOLD_TOKEN (module name + OTW struct)
	bytecodes = new Uint8Array(
		updateIdentifiers(bytecodes, {
			TOKEN_TEMPLATE: moduleName,
		}),
	);

	// 2. Update constants: symbol, name, description, decimals
	bytecodes = new Uint8Array(
		updateConstants(
			bytecodes,
			// Each entry: [newValue, newType, oldValue, oldType]
			// Types: "Vector(U8)" for byte vectors, "U8" for decimals
			[
				[strToBytes(symbol.toUpperCase()), "Vector(U8)", strToBytes("TMPL"), "Vector(U8)"],
				[strToBytes(name), "Vector(U8)", strToBytes("Template Token"), "Vector(U8)"],
				[strToBytes(description), "Vector(U8)", strToBytes("A faction token"), "Vector(U8)"],
				[[decimals], "U8", [9], "U8"],
			],
		),
	);

	const tx = new Transaction();

	const [upgradeCap] = tx.publish({
		modules: [Array.from(bytecodes)],
		dependencies: [
			"0x1", // Move stdlib
			"0x2", // Sui framework
		],
	});

	// Transfer UpgradeCap to sender (they can discard it later if desired)
	tx.transferObjects([upgradeCap], tx.pure.address("0x0")); // placeholder, replaced by sender

	return tx;
}

/** Convert a string to a BCS-compatible byte array for constant patching. */
function strToBytes(s: string): number[] {
	return Array.from(new TextEncoder().encode(s));
}

/**
 * Parse publish transaction results to extract token details.
 */
export function parsePublishResult(
	objectChanges: Array<{ type: string; packageId?: string; objectType?: string; objectId?: string }>,
): PublishTokenResult | null {
	let packageId = "";
	let treasuryCapId = "";
	let coinType = "";
	let moduleName = "";

	for (const change of objectChanges) {
		if (change.type === "published" && change.packageId) {
			packageId = change.packageId;
			// Extract module name from the published modules
			const modules = (change as Record<string, unknown>).modules as string[] | undefined;
			if (modules?.[0]) {
				moduleName = modules[0];
			}
		}
		if (
			change.type === "created" &&
			change.objectType?.includes("::coin::TreasuryCap<")
		) {
			treasuryCapId = change.objectId ?? "";
			// Extract coinType from TreasuryCap<0xpkg::MODULE::MODULE>
			const match = change.objectType.match(/TreasuryCap<(.+)>/);
			if (match) {
				coinType = match[1];
			}
		}
	}

	if (!packageId || !treasuryCapId || !coinType) return null;

	return { packageId, coinType, treasuryCapId, moduleName };
}

// ── Legacy API (kept for gas station compatibility) ─────────────────────────

export function buildMintTokens(params: {
	packageId: string;
	moduleName: string;
	coinType: string;
	treasuryCapId: string;
	amount: number;
	recipient: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::${params.moduleName}::mint`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.treasuryCapId),
			tx.pure.u64(params.amount),
			tx.pure.address(params.recipient),
		],
	});

	return tx;
}

export function buildBurnTokens(params: {
	packageId: string;
	moduleName: string;
	coinType: string;
	treasuryCapId: string;
	coinObjectId: string;
	senderAddress: string;
}): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::${params.moduleName}::burn`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.treasuryCapId),
			tx.object(params.coinObjectId),
		],
	});

	return tx;
}

// ── Query Helpers ───────────────────────────────────────────────────────────

export async function queryTokenSupply(
	client: SuiClient,
	coinType: string,
): Promise<{ totalSupply: bigint }> {
	const supply = await client.getTotalSupply({ coinType });
	return { totalSupply: BigInt(supply.value) };
}

export async function queryOwnedCoins(
	client: SuiClient,
	owner: string,
	coinType: string,
): Promise<Array<{ objectId: string; balance: bigint }>> {
	const coins: Array<{ objectId: string; balance: bigint }> = [];
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const page = await client.getCoins({
			owner,
			coinType,
			cursor: cursor ?? undefined,
			limit: 50,
		});

		for (const coin of page.data) {
			coins.push({
				objectId: coin.coinObjectId,
				balance: BigInt(coin.balance),
			});
		}

		hasMore = page.hasNextPage;
		cursor = page.nextCursor ?? null;
	}

	return coins;
}
