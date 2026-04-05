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
					"Sonar now tracks mining and combat sessions with real-time ore totals, damage dealt/received, and session summaries on the dashboard",
			},
			{
				category: "added",
				description:
					"EVE time toggle to switch between local time and server time across Sonar feeds",
			},
			{
				category: "added",
				description:
					"Tenant filtering for structures and currencies so you only see data for the active tenant (Stillness or Utopia)",
			},
			{
				category: "added",
				description:
					"Low SUI balance errors now show a clickable faucet link to grab free testnet tokens",
			},
			{
				category: "added",
				description:
					"Automatic cleanup of old events so the browser doesn't run out of memory during long play sessions",
			},
			{
				category: "added",
				description:
					"Private Maps invite dialog now has character search instead of requiring a raw Sui address",
			},
			{
				category: "fixed",
				description:
					"Out of Memory crashes on the Sonar page during active play",
			},
			{
				category: "fixed",
				description:
					"Exchange orders not showing up when you select a trading pair",
			},
			{
				category: "fixed",
				description:
					"Fuel estimation was off by 10x because it wasn't applying the fuel type efficiency (F-10 = 10%, EU-90 = 90%)",
			},
			{
				category: "fixed",
				description:
					"EVE Vault connect button was redirecting to a dead page when the extension wasn't installed",
			},
			{
				category: "fixed",
				description:
					"Cargo hold full events weren't being captured in Sonar",
			},
			{
				category: "fixed",
				description:
					"SSU dApp dropdowns (L-point, transfer destination, publish) now work in the in-game browser",
			},
			{
				category: "fixed",
				description:
					"SSU dApp Publish to Map now finds both V1 and V2 maps and won't ask for an extra wallet signature",
			},
			{
				category: "fixed",
				description:
					"Large exchange order amounts were displaying incorrectly due to JS number limits",
			},
			{
				category: "changed",
				description:
					"Removed standings-gated Private Maps since anyone could read the locations on-chain anyway",
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
					"Stillness now has full feature parity with Utopia (extension revoke, gate/SSU rename, all v0.0.19+ functions)",
			},
			{
				category: "added",
				description:
					"Private Maps now have a manual decrypt button and Reset Key option for encryption failures",
			},
			{
				category: "added",
				description:
					"SSU dApp Exchange UI for pair discovery, order placement, cancel orders, and creating trading pairs",
			},
			{
				category: "fixed",
				description:
					"Sonar chain events were duplicating, losing cursors, and dropping alerts under load",
			},
			{
				category: "fixed",
				description:
					"Extension revocation on Stillness was silently failing due to a stale package target",
			},
			{
				category: "fixed",
				description:
					"Private map locations now auto-decrypt on wallet connect and sync correctly on fresh installs",
			},
			{
				category: "fixed",
				description:
					"Eve Vault 'Max epoch' error now shows an actionable message with auto-retry",
			},
			{
				category: "fixed",
				description:
					"SSU dApp delegate sell/buy orders were routing to the wrong player inventory",
			},
			{
				category: "fixed",
				description:
					"Wallet currency list now uses the decommission blocklist to filter out dead tokens",
			},
			{
				category: "changed",
				description:
					"Owned standings registries auto-subscribe so they show up in the extension panel right away",
			},
			{
				category: "removed",
				description:
					"Dropped the access_control module fallback query that was adding unnecessary network calls",
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
					"Sonar for real-time chain and game log event monitoring with watchlists and ping alerts",
			},
			{
				category: "added",
				description:
					"Structures page to manage your deployables with fuel tracking and extension deployment",
			},
			{
				category: "added",
				description:
					"3D Star Map with solar system visualization and jump route planning",
			},
			{
				category: "added",
				description:
					"Private Maps for encrypted location sharing between trusted players",
			},
			{
				category: "added",
				description:
					"Standings page for managing contact and tribe standings with on-chain registry subscriptions",
			},
			{
				category: "added",
				description:
					"Market page for governance token trading and currency creation",
			},
			{
				category: "added",
				description: "Killmails page for tracking combat events",
			},
			{
				category: "added",
				description:
					"Manifest that caches on-chain characters, tribes, and public structure locations locally",
			},
			{
				category: "added",
				description: "PWA support so you can install it as a standalone desktop app",
			},
		],
	},
];
