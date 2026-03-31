// Version and changelog -- pure module (no browser APIs, no app imports).
// Imported by vite.config.ts at build time in a Node context.

export const APP_VERSION = "1.26.03.31";

export interface ChangelogEntry {
	version: string;
	date: string;
	highlights?: string;
	changes: {
		category: "added" | "changed" | "fixed" | "removed";
		description: string;
	}[];
}

export const CHANGELOG: ChangelogEntry[] = [];
