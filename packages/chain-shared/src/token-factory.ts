import { bcs } from "@mysten/bcs";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getCoinSupply, listCoinsGql } from "./graphql-queries";

// WASM module — needs async init before use
let wasmReady: Promise<void> | null = null;
let wasmMod: typeof import("@mysten/move-bytecode-template") | null = null;

async function ensureWasmReady(): Promise<typeof import("@mysten/move-bytecode-template")> {
	if (wasmMod) return wasmMod;
	if (!wasmReady) {
		wasmReady = (async () => {
			const mod = await import("@mysten/move-bytecode-template");
			if (typeof mod.default === "function") {
				await mod.default();
			}
			wasmMod = mod;
		})();
	}
	await wasmReady;
	return wasmMod!;
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

// Pre-compiled TOKEN_TEMPLATE.mv (597 bytes, from contracts/token_template/build/)
// Module: token_template::TOKEN_TEMPLATE
// Contains: init (creates TreasuryCap + CoinMetadata, locks TreasuryCap in Market<T>)
// Depends on: market @ 0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a
const TEMPLATE_BYTECODES_B64 =
	"oRzrCwYAAAAKAQAOAg4eAywdBEkIBVFNB54BsQEIzwKAAQbPAzAK/wMFDIQEJQACAwsBDQIGAg8CEAIRAAICAAIBBwEAAAMADAEAAQMDDAEAAQUEAgAGBQcAAAoAAQABCAoBAQACDAEEAQADBwYHAQIEDgkBAQwCAwMFBAgBBQIIAAcIBAACCwIBCAALAwEIAAEIBQELAQEJAAEIAAcJAAIKAgoCCgILAQEIBQcIBAILAwEJAAsCAQkAAQsCAQgAAQkAAgsDAQkABwgEDENvaW5NZXRhZGF0YQZPcHRpb24OVE9LRU5fVEVNUExBVEULVHJlYXN1cnlDYXAJVHhDb250ZXh0A1VybARjb2luD2NyZWF0ZV9jdXJyZW5jeQ1jcmVhdGVfbWFya2V0C2R1bW15X2ZpZWxkBGluaXQGbWFya2V0BG5vbmUGb3B0aW9uFHB1YmxpY19mcmVlemVfb2JqZWN0CHRyYW5zZmVyCnR4X2NvbnRleHQDdXJsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC+cQVFDS8YVjCG3un0oYMjOFo3NjtOYFaTExxEIpaMRoCAQkKAgUEVE1QTAoCDw5UZW1wbGF0ZSBUb2tlbgoCEA9BIGZhY3Rpb24gdG9rZW4AAgEJAQAAAAACEAsABwAHAQcCBwM4AAoBOAEMAgwDCwI4AgsDCwE4AwIA";

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
	marketId: string;
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

	const mod = await ensureWasmReady();

	// Derive module name from symbol: "GOLD" → "GOLD_TOKEN"
	const moduleName = `${symbol.toUpperCase()}_TOKEN`;

	let bytecodes = getTemplateBytecodes();

	// 1. Update identifiers: TOKEN_TEMPLATE → GOLD_TOKEN (module name + OTW struct)
	// Also update the lowercase address alias: token_template → gold_token
	bytecodes = new Uint8Array(
		mod.update_identifiers(bytecodes, {
			TOKEN_TEMPLATE: moduleName,
			token_template: `${symbol.toLowerCase()}_token`,
		}),
	);

	// 2. Update constants one at a time (API takes one constant per call)
	// Values must be BCS-encoded Uint8Arrays
	// Symbol: "TMPL" → user symbol
	bytecodes = new Uint8Array(
		mod.update_constants(bytecodes, bcsBytes(symbol.toUpperCase()), bcsBytes("TMPL"), "Vector(U8)"),
	);

	// Name: "Template Token" → user name
	bytecodes = new Uint8Array(
		mod.update_constants(bytecodes, bcsBytes(name), bcsBytes("Template Token"), "Vector(U8)"),
	);

	// Description: "A faction token" → user description
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcsBytes(description || name),
			bcsBytes("A faction token"),
			"Vector(U8)",
		),
	);

	// Decimals: 9 → user decimals
	if (decimals !== 9) {
		bytecodes = new Uint8Array(
			mod.update_constants(bytecodes, new Uint8Array([decimals]), new Uint8Array([9]), "U8"),
		);
	}

	const tx = new Transaction();

	const [upgradeCap] = tx.publish({
		modules: [Array.from(bytecodes)],
		dependencies: [
			"0x1", // Move stdlib
			"0x2", // Sui framework
			"0xf9c4151434bc6158c21b7ba7d2860c8ce168dcd8ed39815a4c4c71108a5a311a", // market
		],
	});

	// Transfer UpgradeCap to sender (they can discard it later if desired)
	tx.transferObjects([upgradeCap], tx.pure.address("0x0")); // placeholder, replaced by sender

	return tx;
}

/** BCS-encode a string as vector<u8> for constant patching. */
function bcsBytes(s: string): Uint8Array {
	return bcs
		.vector(bcs.u8())
		.serialize(Array.from(new TextEncoder().encode(s)))
		.toBytes();
}

/**
 * Parse publish transaction results to extract token details.
 * Looks for Market<T> in created objects (token template auto-creates
 * a Market when publishing, locking the TreasuryCap inside).
 */
export function parsePublishResult(
	objectChanges: Array<{
		type: string;
		packageId?: string;
		objectType?: string;
		objectId?: string;
	}>,
): PublishTokenResult | null {
	let packageId = "";
	let marketId = "";
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
		if (change.type === "created" && change.objectType?.includes("::market::Market<")) {
			marketId = change.objectId ?? "";
			// Extract coinType from Market<0xpkg::MODULE::MODULE>
			const match = change.objectType.match(/Market<(.+)>/);
			if (match) {
				coinType = match[1];
			}
		}
	}

	if (!packageId || !marketId || !coinType) return null;

	return { packageId, coinType, marketId, moduleName };
}

// ── Query Helpers ───────────────────────────────────────────────────────────

export async function queryTokenSupply(
	client: SuiGraphQLClient,
	coinType: string,
): Promise<{ totalSupply: bigint }> {
	const supply = await getCoinSupply(client, coinType);
	return { totalSupply: BigInt(supply.value) };
}

export async function queryOwnedCoins(
	client: SuiGraphQLClient,
	owner: string,
	coinType: string,
): Promise<Array<{ objectId: string; balance: bigint }>> {
	const coins: Array<{ objectId: string; balance: bigint }> = [];
	let cursor: string | null = null;
	let hasMore = true;

	while (hasMore) {
		const page = await listCoinsGql(client, owner, coinType, {
			cursor,
			limit: 50,
		});

		for (const coin of page.coins) {
			coins.push({
				objectId: coin.objectId,
				balance: BigInt(coin.balance),
			});
		}

		hasMore = page.hasNextPage;
		cursor = page.cursor;
	}

	return coins;
}
