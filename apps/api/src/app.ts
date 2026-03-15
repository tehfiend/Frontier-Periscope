import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";

export const app = new Hono();

app.use("*", logger());
app.use(
	"*",
	cors({
		origin: process.env.CORS_ORIGIN || "http://localhost:3000",
		credentials: true,
	}),
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		createContext,
	}),
);

export type AppRouter = typeof appRouter;
