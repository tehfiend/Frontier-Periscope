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
		highlights: "Sonar stability, tenant filtering, exchange orders, in-game browser fixes",
		changes: [
			{
				category: "added",
				description:
					"Sonar mining and combat session tracking -- real-time ore totals, damage dealt/received, and session summaries on the dashboard",
			},
			{
				category: "added",
				description:
					"EVE time toggle -- switch between local time and EVE server time across Sonar feeds",
			},
			{
				category: "added",
				description:
					"Tenant filtering for structures and currencies -- only shows data belonging to the active tenant (Stillness or Utopia)",
			},
			{
				category: "added",
				description:
					"Low SUI balance errors now show a clickable faucet link to request free testnet tokens",
			},
			{
				category: "added",
				description:
					"Automatic DB pruning to prevent browser memory issues during long play sessions",
			},
			{
				category: "added",
				description:
					"Private Maps invite dialog uses character search instead of requiring a raw Sui address",
			},
			{
				category: "fixed",
				description:
					"Out of Memory crashes on Sonar page during active play -- eliminated reactive DB queries that re-fired every second",
			},
			{
				category: "fixed",
				description:
					"Exchange orders not displaying -- fixed data read to match on-chain OrderBook structure",
			},
			{
				category: "fixed",
				description:
					"Fuel estimation off by 10x -- now applies fuel type efficiency multiplier (F-10 = 10%, EU-90 = 90%)",
			},
			{
				category: "fixed",
				description:
					"EVE Vault connect button no longer redirects to a non-existent domain when the extension is not installed",
			},
			{
				category: "fixed",
				description:
					"Cargo hold full events now captured in Sonar across all game log channels",
			},
			{
				category: "fixed",
				description:
					"SSU dApp in-game browser compatibility -- replaced native select dropdowns with button lists for L-point, transfer destination, and publish dialog",
			},
			{
				category: "fixed",
				description:
					"SSU dApp Publish to Map now discovers both V1 and V2 maps and no longer prompts an unnecessary wallet signature",
			},
			{
				category: "fixed",
				description:
					"Large exchange order amounts no longer lose precision from JavaScript number overflow",
			},
			{
				category: "changed",
				description:
					"Private Maps -- removed standings-gated map mode (cleartext on-chain locations provided no real access control)",
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
