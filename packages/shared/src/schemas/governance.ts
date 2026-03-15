import { z } from "zod";
import { suiAddressSchema } from "./auth.js";

// ── Tier Model ───────────────────────────────────────────────────────────────

export const orgTierSchema = z.enum(["stakeholder", "member", "serf", "opposition"]);

export const orgTierDataSchema = z.object({
	tribes: z.array(z.number().int()),
	characters: z.array(z.number().int()),
	addresses: z.array(suiAddressSchema),
});

export const organizationSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(100),
	chainObjectId: z.string().nullable(),
	creator: suiAddressSchema,
	stakeholders: orgTierDataSchema,
	members: orgTierDataSchema,
	serfs: orgTierDataSchema,
	opposition: orgTierDataSchema,
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const createOrgSchema = z.object({
	name: z.string().min(1).max(100),
});

export const addToTierSchema = z.object({
	orgId: z.string(),
	tier: orgTierSchema,
	tribeIds: z.array(z.number().int()).optional(),
	characterIds: z.array(z.number().int()).optional(),
	addresses: z.array(suiAddressSchema).optional(),
});

export const removeFromTierSchema = z.object({
	orgId: z.string(),
	tier: orgTierSchema,
	tribeIds: z.array(z.number().int()).optional(),
	characterIds: z.array(z.number().int()).optional(),
	addresses: z.array(suiAddressSchema).optional(),
});

// ── Types ────────────────────────────────────────────────────────────────────

export type OrgTier = z.infer<typeof orgTierSchema>;
export type OrgTierData = z.infer<typeof orgTierDataSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type CreateOrg = z.infer<typeof createOrgSchema>;
export type AddToTier = z.infer<typeof addToTierSchema>;
export type RemoveFromTier = z.infer<typeof removeFromTierSchema>;
