import { z } from "zod";

export const allianceStatusSchema = z.enum(["active", "dissolved"]);
export const agreementTypeSchema = z.enum(["mutual_defense", "trade", "non_aggression", "resource_sharing"]);
export const agreementStatusSchema = z.enum(["proposed", "active", "expired", "terminated"]);

export const allianceSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(100),
	description: z.string().max(2000).optional(),
	status: allianceStatusSchema,
	founderOrgId: z.string().uuid(),
	createdAt: z.date(),
});

export const createAllianceSchema = z.object({
	name: z.string().min(1).max(100),
	description: z.string().max(2000).optional(),
});

export const allianceMemberSchema = z.object({
	id: z.string().uuid(),
	allianceId: z.string().uuid(),
	orgId: z.string().uuid(),
	joinedAt: z.date(),
});

export const agreementSchema = z.object({
	id: z.string().uuid(),
	allianceId: z.string().uuid(),
	type: agreementTypeSchema,
	title: z.string().min(1).max(200),
	terms: z.string().max(5000),
	status: agreementStatusSchema,
	proposedBy: z.string().uuid(),
	createdAt: z.date(),
	expiresAt: z.date().nullable(),
});

export const createAgreementSchema = z.object({
	allianceId: z.string().uuid(),
	type: agreementTypeSchema,
	title: z.string().min(1).max(200),
	terms: z.string().max(5000),
	expiresAt: z.coerce.date().optional(),
});

export type AllianceStatus = z.infer<typeof allianceStatusSchema>;
export type AgreementType = z.infer<typeof agreementTypeSchema>;
export type AgreementStatus = z.infer<typeof agreementStatusSchema>;
export type Alliance = z.infer<typeof allianceSchema>;
export type CreateAlliance = z.infer<typeof createAllianceSchema>;
export type AllianceMember = z.infer<typeof allianceMemberSchema>;
export type Agreement = z.infer<typeof agreementSchema>;
export type CreateAgreement = z.infer<typeof createAgreementSchema>;
