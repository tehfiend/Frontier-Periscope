import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create({
	transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

const isAuthed = middleware(async ({ ctx, next }) => {
	if (!ctx.token) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	// TODO: verify JWT and attach user to context
	return next({
		ctx: {
			...ctx,
			token: ctx.token,
		},
	});
});

export const protectedProcedure = t.procedure.use(isAuthed);
