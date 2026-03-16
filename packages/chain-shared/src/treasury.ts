/**
 * Treasury — Transaction builders and query helpers for the governance_ext::treasury
 * Move module.
 *
 * OrgTreasury is a shared object wrapping TreasuryCap<T>. Once deposited, the
 * TreasuryCap cannot be extracted. Any org stakeholder can mint via the shared
 * treasury, which checks governance::org::is_stakeholder_address().
 *
 * All TX builders return a Transaction ready for signing. The caller is
 * responsible for adding gas config and executing.
 */

import { Transaction, type TransactionResult } from "@mysten/sui/transactions";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { getObjectJson } from "./graphql-queries";

// ── OrgTreasury Types ───────────────────────────────────────────────────────

export interface OrgTreasuryInfo {
	orgId: string;
	totalSupply: bigint;
}

// ── Deposit TreasuryCap ─────────────────────────────────────────────────────

export interface DepositTreasuryCapParams {
	governanceExtPackageId: string;
	orgObjectId: string;
	treasuryCapId: string;
	coinType: string;
	senderAddress: string;
}

export function buildDepositTreasuryCap(params: DepositTreasuryCapParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.governanceExtPackageId}::treasury::deposit_treasury_cap`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgObjectId),
			tx.object(params.treasuryCapId),
		],
	});

	return tx;
}

// ── Mint and Transfer (entry convenience) ───────────────────────────────────

export interface MintAndTransferParams {
	governanceExtPackageId: string;
	orgTreasuryId: string;
	orgObjectId: string;
	coinType: string;
	amount: bigint;
	recipient: string;
	senderAddress: string;
}

export function buildMintAndTransfer(params: MintAndTransferParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.governanceExtPackageId}::treasury::mint_and_transfer`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgTreasuryId),
			tx.object(params.orgObjectId),
			tx.pure.u64(params.amount),
			tx.pure.address(params.recipient),
		],
	});

	return tx;
}

// ── Burn ────────────────────────────────────────────────────────────────────

export interface BurnParams {
	governanceExtPackageId: string;
	orgTreasuryId: string;
	coinType: string;
	coinObjectId: string;
	senderAddress: string;
}

export function buildBurn(params: BurnParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.governanceExtPackageId}::treasury::burn`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgTreasuryId),
			tx.object(params.coinObjectId),
		],
	});

	return tx;
}

// ── Mint (PTB composition — returns Coin<T>) ────────────────────────────────

export interface MintParams {
	governanceExtPackageId: string;
	orgTreasuryId: string;
	orgObjectId: string;
	coinType: string;
	amount: bigint;
	recipient: string;
	senderAddress: string;
}

/**
 * Mint from OrgTreasury, returning the Coin<T> for use in PTB composition.
 * Takes an existing Transaction and returns the TransactionResult (the minted coin).
 * The caller can pass the result to subsequent moveCall arguments in the same TX.
 */
export function buildMint(params: MintParams, tx: Transaction): TransactionResult {
	const result = tx.moveCall({
		target: `${params.governanceExtPackageId}::treasury::mint`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgTreasuryId),
			tx.object(params.orgObjectId),
			tx.pure.u64(params.amount),
			tx.pure.address(params.recipient),
		],
	});

	return result;
}

// ── Query Helpers ───────────────────────────────────────────────────────────

/**
 * Query an OrgTreasury shared object for its org ID and total supply.
 */
export async function queryOrgTreasury(
	client: SuiGraphQLClient,
	treasuryId: string,
): Promise<OrgTreasuryInfo> {
	const obj = await getObjectJson(client, treasuryId);

	if (!obj.json) {
		throw new Error(`OrgTreasury ${treasuryId} not found or not a Move object`);
	}

	const fields = obj.json;

	// In GraphQL JSON, nested structs are returned as nested objects directly
	// treasury_cap.total_supply.value
	const treasuryCap = (fields.treasury_cap as Record<string, unknown>) ?? {};
	const totalSupplyObj = (treasuryCap.total_supply as Record<string, unknown>) ?? {};
	const totalSupply = BigInt(String(totalSupplyObj.value ?? "0"));

	return {
		orgId: String(fields.org_id ?? ""),
		totalSupply,
	};
}

// ── PTB Composition Helpers ─────────────────────────────────────────────────

export interface FundBuyOrderParams {
	governanceExtPackageId: string;
	ssuMarketPackageId: string;
	orgTreasuryId: string;
	orgObjectId: string;
	orgMarketId: string;
	coinType: string;
	mintAmount: bigint;
	ssuId: string;
	typeId: number;
	pricePerUnit: number;
	quantity: number;
	senderAddress: string;
}

/**
 * "Fund buy order" PTB: mint from OrgTreasury -> create buy order (one TX).
 * Composes treasury::mint with ssu_market::create_buy_order.
 */
export function buildFundBuyOrder(params: FundBuyOrderParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Step 1: Mint from OrgTreasury (returns Coin<T>)
	const [mintedCoin] = tx.moveCall({
		target: `${params.governanceExtPackageId}::treasury::mint`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgTreasuryId),
			tx.object(params.orgObjectId),
			tx.pure.u64(params.mintAmount),
			tx.pure.address(params.senderAddress),
		],
	});

	// Step 2: Create buy order on OrgMarket with minted coins
	tx.moveCall({
		target: `${params.ssuMarketPackageId}::ssu_market::create_buy_order`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgMarketId),
			tx.object(params.orgObjectId),
			mintedCoin,
			tx.pure.id(params.ssuId),
			tx.pure.u64(params.typeId),
			tx.pure.u64(params.pricePerUnit),
			tx.pure.u64(params.quantity),
		],
	});

	return tx;
}

export interface FundBountyParams {
	governanceExtPackageId: string;
	bountyBoardPackageId: string;
	orgTreasuryId: string;
	orgObjectId: string;
	boardObjectId: string;
	coinType: string;
	rewardAmount: bigint;
	targetCharacterId: number;
	expiresAt: number;
	senderAddress: string;
}

/**
 * "Fund bounty" PTB: mint from OrgTreasury -> post bounty (one TX).
 * Composes treasury::mint with bounty_board::post_bounty.
 */
export function buildFundBounty(params: FundBountyParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	// Step 1: Mint from OrgTreasury
	const [mintedCoin] = tx.moveCall({
		target: `${params.governanceExtPackageId}::treasury::mint`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.orgTreasuryId),
			tx.object(params.orgObjectId),
			tx.pure.u64(params.rewardAmount),
			tx.pure.address(params.senderAddress),
		],
	});

	// Step 2: Post bounty with minted coins
	tx.moveCall({
		target: `${params.bountyBoardPackageId}::bounty_board::post_bounty`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.boardObjectId),
			tx.pure.u64(params.targetCharacterId),
			mintedCoin,
			tx.pure.u64(params.expiresAt),
		],
	});

	return tx;
}
