// Version and changelog -- pure module (no browser APIs, no app imports).
// Imported by vite.config.ts at build time in a Node context.

export const APP_VERSION = "3.26.04.04";

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
		version: "3.26.04.04",
		date: "2026-04-04",
		highlights: "Sonar stability, exchange orders, in-game browser fixes, private maps overhaul",
		changes: [
			{
				category: "added",
				description:
					"Sonar mining and combat session tracking -- real-time ore totals, damage dealt/received, session summaries",
			},
			{
				category: "added",
				description:
					"Insufficient SUI balance detection with clickable faucet link in error messages",
			},
			{
				category: "added",
				description:
					"Tenant filtering for structures -- only shows structures belonging to the active tenant",
			},
			{
				category: "added",
				description:
					"DB pruning -- automatic cleanup of old sonar and log events to prevent memory growth",
			},
			{
				category: "added",
				description:
					"Private Maps invite dialog now uses character search instead of raw address input",
			},
			{
				category: "fixed",
				description:
					"Out of Memory crashes on Sonar page -- eliminated reactive DB subscriptions that re-fired every second",
			},
			{
				category: "fixed",
				description:
					"Exchange orders not displaying -- orders are read from OrderBook vectors, not dynamic fields",
			},
			{
				category: "fixed",
				description:
					"Fuel estimation off by 10x -- now applies fuel type efficiency multiplier (F-10 = 10%, EU-90 = 90%)",
			},
			{
				category: "fixed",
				description:
					"EVE Vault connect button redirecting to non-existent domain on browsers without the extension",
			},
			{
				category: "fixed",
				description:
					"Cargo hold full events not captured in Sonar -- added detection to notify, hint, and info channels",
			},
			{
				category: "fixed",
				description:
					"SSU dApp in-game browser -- replaced native select dropdowns with button lists (L-point, transfer destination)",
			},
			{
				category: "fixed",
				description:
					"SSU dApp Publish to Map -- queries both V1 and V2 maps, no longer requires pre-deriving encryption key",
			},
			{
				category: "fixed",
				description:
					"Exchange order price/amount precision -- uses string representation to avoid u64 overflow",
			},
			{
				category: "fixed",
				description:
					"GraphQL dynamic field queries now return inline data for MoveObject values",
			},
			{
				category: "changed",
				description:
					"Private Maps -- removed standings-gated map mode (cleartext locations provided no real access control)",
			},
			{
				category: "changed",
				description:
					"Private Maps sync parallelized -- location fetches run concurrently instead of sequentially",
			},
		],
	},
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
