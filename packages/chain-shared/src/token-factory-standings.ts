/**
 * Token Factory Standings -- Bytecode patcher for token_template_standings.
 *
 * Identical to token-factory.ts but produces tokens backed by
 * market_standings::Market<T> instead of market::Market<T>.
 *
 * Additional bytecode constants patched:
 * - REGISTRY_ID_BYTES: 32-byte vector<u8> sentinel (0x00...01) -> actual registry ID
 * - MIN_MINT: u8 sentinel 251 -> actual min_mint threshold
 * - MIN_TRADE: u8 sentinel 252 -> actual min_trade threshold
 * - MIN_BUY: u8 sentinel 253 -> actual min_buy threshold
 *
 * The compiled bytecodes will be embedded after the contract is built.
 * For now, this file exports the builder with a placeholder.
 */

import { bcs } from "@mysten/bcs";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Transaction } from "@mysten/sui/transactions";
import { getCoinSupply, listCoinsGql } from "./graphql-queries";

// WASM module -- needs async init before use
let wasmReady: Promise<void> | null = null;
let wasmMod: typeof import("@mysten/move-bytecode-template") | null = null;

async function ensureWasmReady(): Promise<
	typeof import("@mysten/move-bytecode-template")
> {
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
 * Pre-compiled token_template_standings bytecodes (base64).
 * TODO: Embed after `contracts/token_template_standings/` is built and published.
 * For now this is an empty placeholder -- buildPublishTokenStandings() will throw
 * if called before the bytecodes are populated.
 */
const TEMPLATE_STANDINGS_BYTECODES_B64 = "";

function getTemplateBytecodes(): Uint8Array {
	if (!TEMPLATE_STANDINGS_BYTECODES_B64) {
		throw new Error(
			"token_template_standings bytecodes not yet embedded. " +
				"Build the contract first and update TEMPLATE_STANDINGS_BYTECODES_B64.",
		);
	}
	const binaryStr = atob(TEMPLATE_STANDINGS_BYTECODES_B64);
	const bytes = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) {
		bytes[i] = binaryStr.charCodeAt(i);
	}
	return bytes;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface CreateTokenStandingsParams {
	/** Token symbol, e.g. "GOLD" */
	symbol: string;
	/** Display name, e.g. "Organization Gold" */
	name: string;
	/** Description */
	description: string;
	/** Decimal places (default 9) */
	decimals?: number;
	/** StandingsRegistry object ID (32 bytes hex) */
	registryId: string;
	/** Minimum standing to mint tokens (0-6) */
	minMint: number;
	/** Minimum standing to post sell listings (0-6) */
	minTrade: number;
	/** Minimum standing to buy / post buy orders (0-6) */
	minBuy: number;
}

export interface PublishTokenStandingsResult {
	packageId: string;
	coinType: string;
	marketId: string;
	moduleName: string;
}

/**
 * Build a transaction to publish a custom standings-gated token in-browser.
 *
 * Uses @mysten/move-bytecode-template to safely patch the pre-compiled
 * token_template_standings module. Same patching as token-factory.ts plus
 * additional patches for registry_id, min_mint, min_trade, min_buy.
 *
 * @param params - Token parameters including standings thresholds
 * @param marketStandingsPackageId - Published market_standings package ID (dependency)
 */
export async function buildPublishTokenStandings(
	params: CreateTokenStandingsParams,
	marketStandingsPackageId: string,
): Promise<Transaction> {
	const {
		symbol,
		name,
		description,
		decimals = 9,
		registryId,
		minMint,
		minTrade,
		minBuy,
	} = params;

	const mod = await ensureWasmReady();

	// Derive module name from symbol: "GOLD" -> "GOLD_TOKEN"
	const moduleName = `${symbol.toUpperCase()}_TOKEN`;

	let bytecodes = getTemplateBytecodes();

	// 1. Update identifiers: TOKEN_TEMPLATE -> GOLD_TOKEN (module name + OTW struct)
	bytecodes = new Uint8Array(
		mod.update_identifiers(bytecodes, {
			TOKEN_TEMPLATE: moduleName,
			token_template: `${symbol.toLowerCase()}_token`,
		}),
	);

	// 2. Update string constants one at a time (BCS-encoded vector<u8>)
	// Symbol: "TMPL" -> user symbol
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcsBytes(symbol.toUpperCase()),
			bcsBytes("TMPL"),
			"Vector(U8)",
		),
	);

	// Name: "Template Token" -> user name
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcsBytes(name),
			bcsBytes("Template Token"),
			"Vector(U8)",
		),
	);

	// Description: "A faction token" -> user description
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcsBytes(description || name),
			bcsBytes("A faction token"),
			"Vector(U8)",
		),
	);

	// 3. Update REGISTRY_ID_BYTES: 32-byte sentinel -> actual registry ID bytes
	const registryIdHex = registryId.startsWith("0x")
		? registryId.slice(2)
		: registryId;
	const registryIdBytes = new Uint8Array(
		registryIdHex.match(/.{2}/g)!.map((b) => Number.parseInt(b, 16)),
	);
	// Sentinel: 32 bytes of 0x00 except last byte = 0x01
	const sentinelRegistryId = new Uint8Array(32);
	sentinelRegistryId[31] = 0x01;

	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcs.vector(bcs.u8()).serialize(Array.from(registryIdBytes)).toBytes(),
			bcs.vector(bcs.u8()).serialize(Array.from(sentinelRegistryId)).toBytes(),
			"Vector(U8)",
		),
	);

	// 4. Update u8 constants -- DECIMALS, MIN_MINT, MIN_TRADE, MIN_BUY
	// Only patch DECIMALS if non-default
	if (decimals !== 9) {
		bytecodes = new Uint8Array(
			mod.update_constants(
				bytecodes,
				new Uint8Array([decimals]),
				new Uint8Array([9]),
				"U8",
			),
		);
	}

	// MIN_MINT: sentinel 251 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			new Uint8Array([minMint]),
			new Uint8Array([251]),
			"U8",
		),
	);

	// MIN_TRADE: sentinel 252 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			new Uint8Array([minTrade]),
			new Uint8Array([252]),
			"U8",
		),
	);

	// MIN_BUY: sentinel 253 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			new Uint8Array([minBuy]),
			new Uint8Array([253]),
			"U8",
		),
	);

	const tx = new Transaction();

	const [upgradeCap] = tx.publish({
		modules: [Array.from(bytecodes)],
		dependencies: [
			"0x1", // Move stdlib
			"0x2", // Sui framework
			marketStandingsPackageId, // market_standings
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
 * Looks for Market<T> in created objects (token_template_standings auto-creates
 * a standings-based Market when publishing).
 */
export function parsePublishStandingsResult(
	objectChanges: Array<{
		type: string;
		packageId?: string;
		objectType?: string;
		objectId?: string;
	}>,
): PublishTokenStandingsResult | null {
	let packageId = "";
	let marketId = "";
	let coinType = "";
	let moduleName = "";

	for (const change of objectChanges) {
		if (change.type === "published" && change.packageId) {
			packageId = change.packageId;
			const modules = (change as Record<string, unknown>).modules as
				| string[]
				| undefined;
			if (modules?.[0]) {
				moduleName = modules[0];
			}
		}
		if (
			change.type === "created" &&
			change.objectType?.includes("::market_standings::Market<")
		) {
			marketId = change.objectId ?? "";
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

export async function queryTokenStandingsSupply(
	client: SuiGraphQLClient,
	coinType: string,
): Promise<{ totalSupply: bigint }> {
	const supply = await getCoinSupply(client, coinType);
	return { totalSupply: BigInt(supply.value) };
}

export async function queryOwnedStandingsCoins(
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
