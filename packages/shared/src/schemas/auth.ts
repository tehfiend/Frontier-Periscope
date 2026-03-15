import { z } from "zod";

export const suiAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const authChallengeSchema = z.object({
	address: suiAddressSchema,
});

export const authVerifySchema = z.object({
	address: suiAddressSchema,
	signature: z.string(),
	nonce: z.string(),
});

export const sessionSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().uuid(),
	address: suiAddressSchema,
	characterId: z.string().nullable(),
	tribeId: z.string().nullable(),
	expiresAt: z.date(),
});

export type AuthChallenge = z.infer<typeof authChallengeSchema>;
export type AuthVerify = z.infer<typeof authVerifySchema>;
export type Session = z.infer<typeof sessionSchema>;
