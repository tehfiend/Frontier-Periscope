// Version and changelog -- pure module (no browser APIs, no app imports).
// Imported by vite.config.ts at build time in a Node context.

export const APP_VERSION = "2.26.04.02";

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
		version: "2.26.04.02",
		date: "2026-04-02",
		highlights: "Stillness parity, Sonar reliability, private map encryption fixes",
		changes: [
			{
				category: "added",
				description:
					"Stillness tenant upgrade -- full feature parity with Utopia (extension revoke, gate/SSU rename, all v0.0.19+ functions)",
			},
			{
				category: "added",
				description:
					"Private Maps -- manual decrypt button and Reset Key for encryption failures",
			},
			{
				category: "added",
				description:
					"SSU dApp Exchange UI -- pair discovery, order placement, cancel orders, create trading pairs",
			},
			{
				category: "fixed",
				description:
					"Sonar reliability -- fixed chain event dedup race conditions, cursor init, alert persistence, and query performance",
			},
			{
				category: "fixed",
				description:
					"Extension revocation now works on Stillness (was silently failing due to stale package target)",
			},
			{
				category: "fixed",
				description:
					"Private map locations auto-decrypt on wallet connect and sync on fresh installs",
			},
			{
				category: "fixed",
				description:
					"Eve Vault 'Max epoch' error surfaced with actionable message and auto-retry",
			},
			{
				category: "fixed",
				description:
					"SSU dApp delegate sell/buy orders route to correct player inventory",
			},
			{
				category: "fixed",
				description:
					"Wallet currency filtering switched to decommission blocklist",
			},
			{
				category: "changed",
				description:
					"Owned standings registries auto-subscribe so they appear in extension panel immediately",
			},
			{
				category: "removed",
				description:
					"Removed access_control module fallback query (was adding unnecessary network calls)",
			},
		],
	},
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
				description:
					"Star Map -- 3D WebGL solar system visualization with jump route planning",
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
				description:
					"Market -- governance market trading interface with currency creation",
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
