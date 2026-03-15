import { z } from "zod";
import { suiAddressSchema } from "./auth.js";

export const contractStatusSchema = z.enum(["open", "accepted", "completed", "cancelled", "disputed"]);

export const tradeContractSchema = z.object({
	id: z.string().uuid(),
	creatorId: z.string().uuid(),
	acceptorId: z.string().uuid().nullable(),
	title: z.string().min(1).max(200),
	description: z.string().max(5000),
	status: contractStatusSchema,
	itemTypeId: z.string(),
	quantity: z.number().int().positive(),
	pricePerUnit: z.string(), // bigint as string for precision
	location: z.string(),
	chainTxId: z.string().nullable(),
	createdAt: z.date(),
	expiresAt: z.date().nullable(),
});

export const createTradeContractSchema = z.object({
	title: z.string().min(1).max(200),
	description: z.string().max(5000).optional(),
	itemTypeId: z.string(),
	quantity: z.number().int().positive(),
	pricePerUnit: z.string(),
	location: z.string(),
	expiresAt: z.coerce.date().optional(),
});

export const marketSnapshotSchema = z.object({
	id: z.string().uuid(),
	itemTypeId: z.string(),
	avgPrice: z.string(),
	volume: z.number().int(),
	snapshotAt: z.date(),
});

export type ContractStatus = z.infer<typeof contractStatusSchema>;
export type TradeContract = z.infer<typeof tradeContractSchema>;
export type CreateTradeContract = z.infer<typeof createTradeContractSchema>;
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;
