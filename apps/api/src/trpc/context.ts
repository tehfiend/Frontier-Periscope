import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { createDb, type Database } from "@tehfrontier/db";

let db: Database | null = null;

function getDb(): Database {
	if (!db) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error("DATABASE_URL is not set");
		db = createDb(url);
	}
	return db;
}

export async function createContext(opts: FetchCreateContextFnOptions) {
	const authHeader = opts.req.headers.get("authorization");
	const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

	return {
		db: getDb(),
		token,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
