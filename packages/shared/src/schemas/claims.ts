import { z } from "zod";

// ── On-Chain Claims (org-level, governance contract) ─────────────────────────

export const claimStatusSchema = z.enum(["active", "contested", "removed"]);

export const chainClaimSchema = z.object({
	id: z.string().uuid(),
	orgId: z.string(),
	systemId: z.number().int(),
	name: z.string().max(200),
	status: claimStatusSchema,
	weight: z.number().int().min(0),
	claimedAt: z.date(),
	updatedAt: z.date(),
});

export const createClaimSchema = z.object({
	orgId: z.string(),
	systemId: z.number().int(),
	name: z.string().min(1).max(200),
	weight: z.number().int().min(0).default(100),
});

export const updateClaimSchema = z.object({
	orgId: z.string(),
	systemId: z.number().int(),
	name: z.string().min(1).max(200).optional(),
	weight: z.number().int().min(0).optional(),
});

// ── Personal Nicknames (local-only, no sync) ─────────────────────────────────

export const systemNicknameSchema = z.object({
	id: z.string(),
	systemId: z.number().int(),
	name: z.string().min(1).max(100),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type ClaimStatus = z.infer<typeof claimStatusSchema>;
export type ChainClaim = z.infer<typeof chainClaimSchema>;
export type CreateClaim = z.infer<typeof createClaimSchema>;
export type UpdateClaim = z.infer<typeof updateClaimSchema>;
export type SystemNickname = z.infer<typeof systemNicknameSchema>;
