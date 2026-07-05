// Version and changelog -- pure module (no browser APIs, no app imports).
// Imported by vite.config.ts at build time in a Node context.

export const APP_VERSION = "4.26.07.05";

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
		version: "4.26.07.05",
		date: "2026-07-05",
		highlights:
			"The Industry Calculator is now a Build Queue -- organize your production into named queues and orders, see exactly how every item gets built down to raw materials, and pick the recipe and facility for each one. You can also power your structures on and off right from Periscope, see your EVE balance in the Wallet, and your on-chain storage now shows real item names and icons.",
		changes: [
			{
				category: "added",
				description:
					"The Industry Calculator is now a Build Queue. Group your production into named queues and orders, and get a full build tree for each item that shows how it gets made all the way down to raw materials.",
			},
			{
				category: "added",
				description:
					"Every item in the build tree has its own recipe and facility picker. You can see all the facilities that can make something, choose the one you want, and set which facilities you have available so plans only use what you can actually run.",
			},
			{
				category: "added",
				description:
					"Queues and orders now have a location. Click the location box to pick from the systems you have recently visited, and new orders start at the queue's location by default.",
			},
			{
				category: "added",
				description:
					"Power your structures on and off from the Structures page. A node and the structures connected to it turn on and off together the same way they do in the game, with no gas thanks to EVE Vault's sponsored transactions.",
			},
			{
				category: "added",
				description: "Your Wallet now shows your EVE balance next to SUI.",
			},
			{
				category: "changed",
				description:
					"Your on-chain storage now shows real item names and icons instead of Type numbers. Names come from local game data so they work even while the world API is down, and storage units without a name are labeled by their in-game id instead of a long address.",
			},
			{
				category: "changed",
				description:
					"Stock and Assets now label each storage the same clear way -- its type, a number that is unique per system, and the system name, like Mini Storage #5 O3S-11J.",
			},
			{
				category: "changed",
				description:
					"The Open dApp link on a structure now takes you to the official EVE Frontier dApp, unless that structure's dApp URL was actually changed to point somewhere else.",
			},
			{
				category: "fixed",
				description:
					"The star map and system search now show the real Cycle 6 system names (like O3S-11J), pulled straight from the game client instead of internal codes.",
			},
			{
				category: "fixed",
				description:
					"Materials you already have now correctly reduce what you need to build. If you are holding some of a component, the tree stops asking you to build the things that go into it.",
			},
			{
				category: "fixed",
				description:
					"The Structures page now shows the correct type for each structure -- Mini Printer, Refinery, and Mini Storage instead of a generic 'assembly' or 'Storage Unit'.",
			},
		],
	},
	{
		version: "4.26.06.26",
		date: "2026-06-26",
		highlights:
			"Cycle 6 update -- chain features updated for the new world, refreshed static data, new Rift Intel tracking, a cycle-reset tool, and Sonar that reads more from your logs with new dashboard graphs",
		changes: [
			{
				category: "changed",
				description:
					"Updated all chain-dependent features (Wallet, Structures, Market, Manifest, Killmails, Private Maps) for the Cycle 6 world -- republished the SSU contract against the new world package",
			},
			{
				category: "added",
				description:
					"Rift Intel: newly-revealed Cycle 6 rifts now ping in Sonar and plot on the Star Map as fuchsia markers",
			},
			{
				category: "changed",
				description:
					"Refreshed all Cycle 6 static game data -- items, blueprints, facilities, solar systems, and celestials -- rebuilt from the latest game client",
			},
			{
				category: "added",
				description:
					"Reusable cycle-reset in Settings -> Danger Zone: archives your cycle-bound data (characters, structures, manifest caches, standings, sonar/log history) to a file, then clears it for a fresh cycle while keeping preferences and static map data",
			},
			{
				category: "fixed",
				description:
					"Cleared stale Cycle 5 chain data on first load so structures, manifest, and Sonar re-sync cleanly against the Cycle 6 world",
			},
			{
				category: "fixed",
				description:
					"Industry Calculator and Blueprint Library now classify the Cycle 6 Material Processor as a refinery (ore reprocessing) instead of listing it under Other",
			},
			{
				category: "fixed",
				description:
					"Adding a character by wallet no longer fails when the character's on-chain name has not resolved yet",
			},
			{
				category: "added",
				description:
					"Added Source Preferences to the Industry Calculator so you can steer where your materials come from. Set each material group to Exclude, Avoid, Normal, or Prefer and the optimizer works around your choices.",
			},
			{
				category: "added",
				description:
					"The Blueprint Library now has a search box on every column, and the old search is clearly labeled as the global one that searches everything. Your searches stick around when you come back, and each one has its own clear button.",
			},
			{
				category: "added",
				description:
					"Added a recipe column to the production list so you can see how each item gets made at a glance.",
			},
			{
				category: "fixed",
				description:
					"Fixed the Industry Calculator so it stops showing surplus materials that don't make sense. It now only gives you plans you can actually build, and the raw material list always adds up.",
			},
			{
				category: "changed",
				description:
					"Removed the contest-entry labels from the Blueprint Library and Industry Calculator",
			},
			{
				category: "added",
				description:
					"Sonar now reads a lot more from your game logs. It catches inbound tackle and warp-jam warnings, stargate aggression locks, self-destruct messages, fleet and conversation invites, deployable placement fails, capacitor and power grid module failures, action-disruption warnings, obscured sightlines, and out-of-range targets. The tackle and aggression-lock warnings ping by default since they are safety signals.",
			},
			{
				category: "added",
				description:
					"Mining run summaries now tell you why a run ended, whether your cargo filled up, the asteroid was depleted, or you drifted out of mining range. You see it in both the Sonar feed and the Mining tab.",
			},
			{
				category: "added",
				description:
					"The Sonar dashboard now has live charts for your mining rate, damage dealt, and damage received over time, so you can watch the trend instead of just the current number. The combat charts show a simple no recent activity note when nothing has happened lately.",
			},
			{
				category: "changed",
				description:
					"Combat session summaries now show hit counts next to the damage and DPS numbers.",
			},
			{
				category: "fixed",
				description:
					"Sonar no longer drops pings when a burst of events comes in all at once.",
			},
		],
	},
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
					"Event log is now continuous and only trims the oldest entries when it hits the cap (50k sonar, 100k log events)",
			},
			{
				category: "added",
				description:
					"Private Maps invite dialog now has character search instead of requiring a raw Sui address",
			},
			{
				category: "added",
				description:
					"Sonar event details now highlight numbers so they pop against the rest of the text",
			},
			{
				category: "added",
				description:
					"Distinct alert sounds for cargo full (warning alarm) and getting shot first (threat pulse) so you know what's happening without looking",
			},
			{
				category: "fixed",
				description:
					"Sonar notifications no longer fire when reprocessing existing log files",
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
