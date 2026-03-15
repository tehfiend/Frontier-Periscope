import { eq } from "drizzle-orm";
import { sessions, users } from "@tehfrontier/db/schema";
import { authChallengeSchema, authVerifySchema } from "@tehfrontier/shared";
import { publicProcedure, router } from "../trpc.js";

function generateNonce(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export const authRouter = router({
	challenge: publicProcedure.input(authChallengeSchema).mutation(async ({ ctx, input }) => {
		// Upsert user
		const existing = await ctx.db.query.users.findFirst({
			where: eq(users.suiAddress, input.address),
		});

		let userId: string;
		if (existing) {
			userId = existing.id;
		} else {
			const [newUser] = await ctx.db
				.insert(users)
				.values({ suiAddress: input.address })
				.returning();
			userId = newUser.id;
		}

		// Create session with nonce
		const nonce = generateNonce();
		const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min to sign

		await ctx.db.insert(sessions).values({
			userId,
			nonce,
			expiresAt,
		});

		return { nonce };
	}),

	verify: publicProcedure.input(authVerifySchema).mutation(async ({ ctx, input }) => {
		// Find session by nonce
		const session = await ctx.db.query.sessions.findFirst({
			where: eq(sessions.nonce, input.nonce),
		});

		if (!session) {
			throw new Error("Invalid or expired nonce");
		}

		if (new Date() > session.expiresAt) {
			throw new Error("Nonce expired");
		}

		// TODO: verify Sui signature against the nonce and address
		// const isValid = await verifySuiSignature(input.address, input.signature, input.nonce);

		// For now, generate a simple JWT-like token
		// TODO: replace with proper jose JWT signing
		const token = `tf_${generateNonce()}`;

		// Update session with token
		await ctx.db
			.update(sessions)
			.set({ token, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }) // 7 days
			.where(eq(sessions.id, session.id));

		return { token, userId: session.userId };
	}),

	me: publicProcedure.query(async ({ ctx }) => {
		if (!ctx.token) return null;

		const session = await ctx.db.query.sessions.findFirst({
			where: eq(sessions.token, ctx.token),
		});

		if (!session || new Date() > session.expiresAt) return null;

		const user = await ctx.db.query.users.findFirst({
			where: eq(users.id, session.userId),
		});

		return user ?? null;
	}),
});
