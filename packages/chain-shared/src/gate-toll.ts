import { Transaction } from "@mysten/sui/transactions";
import type { SuiClient } from "@mysten/sui/client";
import type { TollInfo } from "./types";

function extractFields(content: unknown): Record<string, unknown> {
	const c = content as { fields?: Record<string, unknown> };
	return c?.fields ?? {};
}

export async function queryTollConfig(
	client: SuiClient,
	configObjectId: string,
	gateId: string,
): Promise<TollInfo | null> {
	try {
		const df = await client.getDynamicFieldObject({
			parentId: configObjectId,
			name: { type: "0x2::object::ID", value: gateId },
		});
		if (!df.data?.content) return null;

		const fields = extractFields(df.data.content);
		return {
			fee: Number(fields.fee ?? 0),
			feeRecipient: (fields.fee_recipient as string) ?? "",
			permitDurationMs: Number(fields.permit_duration_ms ?? 600000),
			freeTribes: (fields.free_tribes as number[]) ?? [],
			freeCharacters: (fields.free_characters as number[]) ?? [],
		};
	} catch {
		return null;
	}
}

export interface SetTollParams {
	packageId: string;
	configObjectId: string;
	gateId: string;
	fee: number;
	feeRecipient: string;
	permitDurationMs: number;
	freeTribes: number[];
	freeCharacters: number[];
	senderAddress: string;
}

export function buildSetToll(params: SetTollParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::gate_toll::set_toll`,
		arguments: [
			tx.object(params.configObjectId),
			tx.pure.id(params.gateId),
			tx.pure.u64(params.fee),
			tx.pure.address(params.feeRecipient),
			tx.pure.u64(params.permitDurationMs),
			tx.pure.vector("u32", params.freeTribes),
			tx.pure.vector("u64", params.freeCharacters),
		],
	});

	return tx;
}
