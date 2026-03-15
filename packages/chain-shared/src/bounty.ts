import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import type { BountyInfo } from "./types";

function extractFields(content: unknown): Record<string, unknown> {
	const c = content as { fields?: Record<string, unknown> };
	return c?.fields ?? {};
}

export async function queryBounty(
	client: SuiClient,
	boardObjectId: string,
	bountyId: number,
): Promise<BountyInfo | null> {
	try {
		const df = await client.getDynamicFieldObject({
			parentId: boardObjectId,
			name: { type: "u64", value: String(bountyId) },
		});
		if (!df.data?.content) return null;

		const fields = extractFields(df.data.content);
		return {
			bountyId,
			poster: (fields.poster as string) ?? "",
			targetCharacterId: Number(fields.target_character_id ?? 0),
			rewardAmount: Number(fields.reward_amount ?? 0),
			expiresAt: Number(fields.expires_at ?? 0),
		};
	} catch {
		return null;
	}
}

export interface PostBountyParams {
	packageId: string;
	boardObjectId: string;
	coinType: string;
	targetCharacterId: number;
	rewardObjectId: string;
	expiresAt: number;
	senderAddress: string;
}

export function buildPostBounty(params: PostBountyParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::bounty_board::post_bounty`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.boardObjectId),
			tx.pure.u64(params.targetCharacterId),
			tx.object(params.rewardObjectId),
			tx.pure.u64(params.expiresAt),
		],
	});

	return tx;
}

export interface ClaimBountyParams {
	packageId: string;
	boardObjectId: string;
	coinType: string;
	bountyId: number;
	targetCharacterId: number;
	senderAddress: string;
}

export function buildClaimBounty(params: ClaimBountyParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::bounty_board::claim_bounty`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.boardObjectId),
			tx.pure.u64(params.bountyId),
			tx.pure.u64(params.targetCharacterId),
			tx.object("0x6"), // Clock
		],
	});

	return tx;
}

export interface CancelBountyParams {
	packageId: string;
	boardObjectId: string;
	coinType: string;
	bountyId: number;
	senderAddress: string;
}

export function buildCancelBounty(params: CancelBountyParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::bounty_board::cancel_bounty`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.boardObjectId),
			tx.pure.u64(params.bountyId),
		],
	});

	return tx;
}
