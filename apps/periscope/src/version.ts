// Version and changelog -- pure module (no browser APIs, no app imports).
// Imported by vite.config.ts at build time in a Node context.

export const APP_VERSION = "1.26.03.30";

export interface ChangelogEntry {
	version: string;
	date: string;
	highlights?: string;
	changes: {
		category: "added" | "changed" | "fixed" | "removed";
		description: string;
	}[];
}

export const CHANGELOG: ChangelogEntry[] = [
	{
		version: "1.26.03.30",
		date: "2026-03-30",
		highlights: "First public release",
		changes: [
			{
				category: "added",
				description:
					"Sonar -- real-time chain and game log event monitoring with watchlists and ping alerts",
			},
			{
				category: "added",
				description:
					"Structures -- manage owned deployables with fuel tracking and standings-based extension deployment",
			},
			{
				category: "added",
				description: "Star Map -- 3D WebGL solar system visualization with jump route planning",
			},
			{
				category: "added",
				description:
					"Private Maps -- encrypted location sharing via sealed-box cryptography",
			},
			{
				category: "added",
				description:
					"Standings -- contact and tribe standings management with on-chain registry subscriptions",
			},
			{
				category: "added",
				description: "Market -- governance market trading interface with currency creation",
			},
			{
				category: "added",
				description: "Killmails -- combat event tracking and threat assessment",
			},
			{
				category: "added",
				description:
					"Manifest -- local cache of on-chain characters, tribes, and public structure locations",
			},
			{
				category: "added",
				description: "PWA support -- install as a standalone desktop app",
			},
		],
	},
];
