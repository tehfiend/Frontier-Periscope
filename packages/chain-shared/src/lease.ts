import { Transaction } from "@mysten/sui/transactions";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import type { LeaseInfo } from "./types";
import { getDynamicFieldJson } from "./graphql-queries";

export async function queryLease(
	client: SuiGraphQLClient,
	registryObjectId: string,
	assemblyId: string,
): Promise<LeaseInfo | null> {
	try {
		const fields = await getDynamicFieldJson(client, registryObjectId, {
			type: "0x2::object::ID",
			value: assemblyId,
		});
		if (!fields) return null;

		return {
			tenant: (fields.tenant as string) ?? "",
			tenantTribe: Number(fields.tenant_tribe ?? 0),
			ratePerDay: Number(fields.rate_per_day ?? 0),
			lastChargedAt: Number(fields.last_charged_at ?? 0),
			landlord: (fields.landlord as string) ?? "",
			balanceAmount: Number(fields.balance_amount ?? 0),
		};
	} catch {
		return null;
	}
}

export interface CreateLeaseParams {
	packageId: string;
	registryObjectId: string;
	assemblyId: string;
	tenant: string;
	tenantTribe: number;
	ratePerDay: number;
	senderAddress: string;
}

export function buildCreateLease(params: CreateLeaseParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::lease::create_lease`,
		arguments: [
			tx.object(params.registryObjectId),
			tx.pure.id(params.assemblyId),
			tx.pure.address(params.tenant),
			tx.pure.u32(params.tenantTribe),
			tx.pure.u64(params.ratePerDay),
			tx.object("0x6"), // Clock
		],
	});

	return tx;
}

export interface DepositRentParams {
	packageId: string;
	registryObjectId: string;
	coinType: string;
	assemblyId: string;
	paymentObjectId: string;
	senderAddress: string;
}

export function buildDepositRent(params: DepositRentParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::lease::deposit_rent`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.registryObjectId),
			tx.pure.id(params.assemblyId),
			tx.object(params.paymentObjectId),
		],
	});

	return tx;
}

export interface CancelLeaseParams {
	packageId: string;
	registryObjectId: string;
	coinType: string;
	assemblyId: string;
	senderAddress: string;
}

export function buildCancelLease(params: CancelLeaseParams): Transaction {
	const tx = new Transaction();
	tx.setSender(params.senderAddress);

	tx.moveCall({
		target: `${params.packageId}::lease::cancel_lease`,
		typeArguments: [params.coinType],
		arguments: [
			tx.object(params.registryObjectId),
			tx.pure.id(params.assemblyId),
			tx.object("0x6"), // Clock
		],
	});

	return tx;
}
