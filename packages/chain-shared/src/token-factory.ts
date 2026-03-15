import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import type { TokenInfo } from "./types";

/**
 * Bytecode patching for the token template module.
 *
 * The pre-compiled template bytecodes contain "TOKEN_TEMPLATE" as the
 * module name and OTW struct name. We patch these bytes to create
 * custom-named tokens.
 *
 * NOTE: Actual bytecodes must be extracted from a compiled Move build
 * and embedded here as base64. This is a placeholder showing the API.
 */

// Placeholder — replace with actual compiled bytecodes after `sui move build`
let TEMPLATE_BYTECODES: Uint8Array | null = null;

/**
 * Set the pre-compiled template bytecodes.
 * Call this once at app startup with the bytecodes from the compiled template.
 */
export function setTemplateBytecodes(bytecodes: Uint8Array): void {
	TEMPLATE_BYTECODES = bytecodes;
}

/**
 * Patch the template bytecodes with a custom token name.
 * Replaces all occurrences of "TOKEN_TEMPLATE" with the new name.
 */
export function patchBytecodes(
	bytecodes: Uint8Array,
	tokenName: string,
): Uint8Array {
	const oldName = "TOKEN_TEMPLATE";
	const oldBytes = new TextEncoder().encode(oldName);
	const newBytes = new TextEncoder().encode(tokenName);

	// Find and replace all occurrences
	const result: number[] = [];
	let i = 0;
	while (i < bytecodes.length) {
		let match = true;
		if (i + oldBytes.length <= bytecodes.length) {
			for (let j = 0; j < oldBytes.length; j++) {
				if (bytecodes[i + j] !== oldBytes[j]) {
					match = false;
					break;
				}
			}
		} else {
			match = false;
		}

		if (match) {
			for (const b of newBytes) result.push(b);
			i += oldBytes.length;
		} else {
			result.push(bytecodes[i]);
			i++;
		}
	}

	return new Uint8Array(result);
}

/**
 * Patch metadata byte vectors in the bytecodes.
 * Replaces symbol, name, and description placeholders.
 */
export function patchMetadata(
	bytecodes: Uint8Array,
	metadata: { symbol: string; name: string; description: string },
): Uint8Array {
	const replacements: [string, string][] = [
		["TMPL", metadata.symbol],
		["Template Token", metadata.name],
		["A faction token", metadata.description],
	];

	let result = bytecodes;
	for (const [oldStr, newStr] of replacements) {
		result = patchBytecodes(result, newStr);
		// Re-use patchBytecodes logic but with custom old/new
		const oldBytes = new TextEncoder().encode(oldStr);
		const newBytesArr = new TextEncoder().encode(newStr);
		const patched: number[] = [];
		let i = 0;
		while (i < result.length) {
			let match = true;
			if (i + oldBytes.length <= result.length) {
				for (let j = 0; j < oldBytes.length; j++) {
					if (result[i + j] !== oldBytes[j]) {
						match = false;
						break;
					}
				}
			} else {
				match = false;
			}

			if (match) {
				for (const b of newBytesArr) patched.push(b);
				i += oldBytes.length;
			} else {
				patched.push(result[i]);
				i++;
			}
		}
		result = new Uint8Array(patched);
	}

	return result;
}

export interface CreateTokenParams {
	tokenName: string;
	symbol: string;
	displayName: string;
	description: string;
	decimals: number;
	senderAddress: string;
}

/**
 * Build a transaction to publish a new custom token.
 * Requires template bytecodes to be set via setTemplateBytecodes().
 */
export function buildPublishToken(params: CreateTokenParams): Transaction {
	if (!TEMPLATE_BYTECODES) {
		throw new Error("Template bytecodes not loaded. Call setTemplateBytecodes() first.");
	}

	// Patch module name
	let patched = patchBytecodes(TEMPLATE_BYTECODES, params.tokenName);

	// Patch metadata
	patched = patchMetadata(patched, {
		symbol: params.symbol,
		name: params.displayName,
		description: params.description,
	});

	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Publish the patched module
	const [upgradeCap] = tx.publish({
		modules: [Array.from(patched)],
		dependencies: [
			"0x1", // Move stdlib
			"0x2", // Sui framework
		],
	});

	// Transfer upgrade cap to sender (or destroy it)
	tx.transferObjects([upgradeCap], params.senderAddress);

	return tx;
}

/**
 * Build a transaction to mint tokens.
 */
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

/**
 * Build a transaction to burn tokens.
 */
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

/**
 * Query total supply for a coin type.
 * Uses the CoinMetadata or TreasuryCap supply on chain.
 */
export async function queryTokenSupply(
	client: SuiClient,
	coinType: string,
): Promise<{ totalSupply: bigint }> {
	const supply = await client.getTotalSupply({ coinType });
	return { totalSupply: BigInt(supply.value) };
}

/**
 * Query owned coins of a specific type for an address.
 */
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
