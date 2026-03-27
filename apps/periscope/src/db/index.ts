import Dexie, { type EntityTable } from "dexie";
import type {
	AssemblyIntel,
	AssemblyPolicy,
	BetrayalAlert,
	CacheMetadataEntry,
	Celestial,
	CharacterRecord,
	ChatIntelEntry,
	Constellation,
	Contact,
	CurrencyRecord,
	DeployableIntel,
	ExtensionRecord,
	GameType,
	GroupMember,
	Jump,
	KillmailIntel,
	LogEvent,
	LogOffset,
	LogSession,
	ManifestCharacter,
	ManifestLocation,
	ManifestMapLocation,
	ManifestMarket,
	ManifestPrivateMap,
	ManifestPrivateMapIndex,
	ManifestPrivateMapV2,
	ManifestRegistry,
	ManifestStandingEntry,
	ManifestStandingsList,
	ManifestTribe,
	OrgTierMember,
	OrganizationRecord,
	PermissionGroup,
	PlayerIntel,
	Region,
	RegistryStanding,
	SettingsEntry,
	SolarSystem,
	SonarChannelState,
	SonarEvent,
	SonarWatchItem,
	StructureExtensionConfig,
	SubscribedRegistry,
	SyncMeta,
	TradeNodeRecord,
	TreasuryRecord,
} from "./types";

class PeriscopeDB extends Dexie {
	// Static data (NOT encrypted)
	solarSystems!: EntityTable<SolarSystem, "id">;
	constellations!: EntityTable<Constellation, "id">;
	regions!: EntityTable<Region, "id">;
	// Compound primary key [fromSystemId+toSystemId]. EntityTable<T,K> requires a single key
	// field — Dexie maps the first component. The actual PK is the compound index.
	jumps!: EntityTable<Jump, "fromSystemId">;
	gameTypes!: EntityTable<GameType, "id">;
	celestials!: EntityTable<Celestial, "id">;

	// Characters
	characters!: EntityTable<CharacterRecord, "id">;

	// Intel tables
	deployables!: EntityTable<DeployableIntel, "id">;
	assemblies!: EntityTable<AssemblyIntel, "id">;
	players!: EntityTable<PlayerIntel, "id">;
	killmails!: EntityTable<KillmailIntel, "id">;
	chatIntel!: EntityTable<ChatIntelEntry, "id">;

	// App state
	settings!: EntityTable<SettingsEntry, "key">;
	cacheMetadata!: EntityTable<CacheMetadataEntry, "key">;
	logOffsets!: EntityTable<LogOffset, "fileName">;

	// Extensions
	extensions!: EntityTable<ExtensionRecord, "id">;

	// Log analyzer
	logEvents!: EntityTable<LogEvent, "id">;
	logSessions!: EntityTable<LogSession, "id">;

	// Permissions (tables dropped in V29 -- declarations kept for backward compat with consuming code)
	permissionGroups!: EntityTable<PermissionGroup, "id">;
	groupMembers!: EntityTable<GroupMember, "id">;
	assemblyPolicies!: EntityTable<AssemblyPolicy, "id">;
	betrayalAlerts!: EntityTable<BetrayalAlert, "id">;

	// Manifest (local chain cache)
	manifestCharacters!: EntityTable<ManifestCharacter, "id">;
	manifestTribes!: EntityTable<ManifestTribe, "id">;
	manifestLocations!: EntityTable<ManifestLocation, "id">;
	manifestMarkets!: EntityTable<ManifestMarket, "id">;
	manifestRegistries!: EntityTable<ManifestRegistry, "id">;
	manifestPrivateMapIndex!: EntityTable<ManifestPrivateMapIndex, "id">;

	// Private Maps (encrypted location sharing cache)
	manifestPrivateMaps!: EntityTable<ManifestPrivateMap, "id">;
	manifestMapLocations!: EntityTable<ManifestMapLocation, "id">;

	// Standings (encrypted contact standings cache) -- @deprecated, superseded by contacts
	manifestStandingsLists!: EntityTable<ManifestStandingsList, "id">;
	manifestStandingEntries!: EntityTable<ManifestStandingEntry, "id">;

	// Contacts (local-only standings)
	contacts!: EntityTable<Contact, "id">;

	// Registry subscriptions (on-chain standings registries)
	subscribedRegistries!: EntityTable<SubscribedRegistry, "id">;
	registryStandings!: EntityTable<RegistryStanding, "id">;

	// Governance
	organizations!: EntityTable<OrganizationRecord, "id">;
	orgTierMembers!: EntityTable<OrgTierMember, "id">;
	currencies!: EntityTable<CurrencyRecord, "id">;

	// Trade
	tradeNodes!: EntityTable<TradeNodeRecord, "id">;

	// Sonar
	sonarEvents!: EntityTable<SonarEvent, "id">;
	sonarState!: EntityTable<SonarChannelState, "channel">;
	sonarWatchlist!: EntityTable<SonarWatchItem, "id">;

	// Private Maps V2 (dual-mode: encrypted + cleartext standings)
	manifestPrivateMapsV2!: EntityTable<ManifestPrivateMapV2, "id">;

	// Structure Extension Configs (standings-based)
	structureExtensionConfigs!: EntityTable<StructureExtensionConfig, "id">;

	// Treasury
	treasuries!: EntityTable<TreasuryRecord, "id">;

	constructor() {
		super("frontier-periscope");

		this.version(1).stores({
			// Static data
			solarSystems: "id, name, constellationId, regionId",
			constellations: "id, name, regionId",
			regions: "id, name",
			jumps: "[fromSystemId+toSystemId], fromSystemId, toSystemId",

			// Intel tables
			deployables: "id, objectId, assemblyType, status, label, updatedAt, *tags",
			assemblies: "id, assemblyType, objectId, owner, status, updatedAt, *tags",
			players: "id, address, name, threat, updatedAt, *tags",
			locations: "id, name, systemId, category, updatedAt, *tags",
			killmails: "id, killmailId, victim, finalBlow, timestamp, *tags",
			notes: "id, title, updatedAt, *tags, *linkedEntities",
			activities: "id, activityType, sessionId, systemId, createdAt, *tags",
			chatIntel: "id, channel, reporter, systemId, createdAt, expiresAt, *reportedPlayers, *tags",
			targets: "id, address, watchStatus, lastPolled, lastActivity, *tags",
			targetEvents: "id, targetId, timestamp, event, assemblyId",
			inventoryDiffs: "id, targetId, assemblyId, timestamp, typeId",

			// App state
			settings: "key",
			cacheMetadata: "key",
			logOffsets: "fileName",
		});

		this.version(2).stores({
			logEvents: "++id, sessionId, timestamp, type, [sessionId+type], [sessionId+timestamp]",
			logSessions: "id, characterName, startedAt",
		});

		this.version(3).stores({
			gameTypes: "id, name, groupId, groupName, categoryId, categoryName",
		});

		this.version(4)
			.stores({
				characters: "id, characterName, suiAddress, isActive, updatedAt",
				deployables: "id, objectId, assemblyType, owner, status, label, updatedAt, *tags",
			})
			.upgrade(async (tx) => {
				const settings = tx.table("settings");
				const characters = tx.table("characters");
				const deployables = tx.table("deployables");
				const logSessions = tx.table("logSessions");

				// Read old profile settings
				const suiAddressEntry = await settings.get("suiAddress");
				const characterNameEntry = await settings.get("characterName");
				const suiAddress = suiAddressEntry?.value as string | undefined;
				const characterName = characterNameEntry?.value as string | undefined;

				if (!suiAddress && !characterName) return;

				// Try to find a characterId from existing log sessions
				let characterId: string | undefined;
				if (characterName) {
					const sessions = await logSessions.where("characterName").equals(characterName).toArray();
					if (sessions.length > 0 && sessions[0].characterId) {
						characterId = sessions[0].characterId;
					}
				}

				// Create the character record
				const id = characterId || crypto.randomUUID();
				const now = new Date().toISOString();
				await characters.add({
					id,
					characterId: characterId || undefined,
					characterName: characterName || "Unknown",
					suiAddress: suiAddress || undefined,
					isActive: false,
					createdAt: now,
					updatedAt: now,
				});

				// Backfill owner on all existing deployables
				if (suiAddress) {
					await deployables.toCollection().modify({ owner: suiAddress });
				}

				// Store the active character ID
				await settings.put({ key: "activeCharacterId", value: id });

				// Clean up old settings keys
				await settings.delete("suiAddress");
				await settings.delete("characterName");
			});

		this.version(5).stores({
			extensions: "id, assemblyId, templateId, status, owner, updatedAt",
		});

		this.version(6)
			.stores({
				permissionGroups: "id, name, isBuiltin, updatedAt",
				groupMembers: "id, groupId, kind, characterId, tribeId, [groupId+kind]",
				assemblyPolicies: "id, assemblyType, syncStatus, updatedAt",
			})
			.upgrade(async (tx) => {
				const groups = tx.table("permissionGroups");
				const now = new Date().toISOString();
				await groups.bulkAdd([
					{
						id: "__self__",
						name: "Self",
						color: "#22d3ee",
						isBuiltin: true,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: "__everyone__",
						name: "Everyone",
						color: "#a1a1aa",
						isBuiltin: true,
						createdAt: now,
						updatedAt: now,
					},
				]);
			});

		this.version(7).stores({
			betrayalAlerts: "id, status, attackerCharacterId, attackerAddress, source, createdAt",
		});

		// V8: _hlc indexes on all syncable tables, backfill sync metadata fields
		this.version(8)
			.stores({
				// P2P sync tables (dropped in V21)
				syncPeers: "id, trustTier, lastSeen",
				syncLog: "++id, timestamp, action, table, hlc",
				sharingGroups: "id, name",

				// Add _hlc index to all syncable tables (re-declare to add index)
				deployables: "id, objectId, assemblyType, owner, status, label, updatedAt, _hlc, *tags",
				assemblies: "id, assemblyType, objectId, owner, status, updatedAt, _hlc, *tags",
				players: "id, address, name, threat, updatedAt, _hlc, *tags",
				locations: "id, name, systemId, category, updatedAt, _hlc, *tags",
				killmails: "id, killmailId, victim, finalBlow, timestamp, _hlc, *tags",
				notes: "id, title, updatedAt, _hlc, *tags, *linkedEntities",
				activities: "id, activityType, sessionId, systemId, createdAt, _hlc, *tags",
				chatIntel:
					"id, channel, reporter, systemId, createdAt, expiresAt, _hlc, *reportedPlayers, *tags",
				targets: "id, address, watchStatus, lastPolled, lastActivity, _hlc, *tags",
				targetEvents: "id, targetId, timestamp, event, assemblyId, _hlc",
				inventoryDiffs: "id, targetId, assemblyId, timestamp, typeId, _hlc",
				characters: "id, characterName, suiAddress, isActive, updatedAt, _hlc",
				extensions: "id, assemblyId, templateId, status, owner, updatedAt, _hlc",
				permissionGroups: "id, name, isBuiltin, updatedAt, _hlc",
				groupMembers: "id, groupId, kind, characterId, tribeId, [groupId+kind], _hlc",
				assemblyPolicies: "id, assemblyType, syncStatus, updatedAt, _hlc",
				betrayalAlerts: "id, status, attackerCharacterId, attackerAddress, source, createdAt, _hlc",
			})
			.upgrade(async (tx) => {
				const settings = tx.table("settings");

				// Generate a unique instance ID for this browser
				const instanceId = crypto.randomUUID();
				await settings.put({ key: "instanceId", value: instanceId });

				// Backfill _hlc, _deleted, _origin on all syncable tables
				const syncTableNames = [
					"deployables",
					"assemblies",
					"players",
					"locations",
					"killmails",
					"notes",
					"activities",
					"chatIntel",
					"targets",
					"targetEvents",
					"inventoryDiffs",
					"characters",
					"extensions",
					"permissionGroups",
					"groupMembers",
					"assemblyPolicies",
					"betrayalAlerts",
				];

				const origin = instanceId.slice(0, 8);
				let counter = 0;
				const wallMs = Date.now();

				for (const tableName of syncTableNames) {
					const table = tx.table(tableName);
					await table.toCollection().modify((record: SyncMeta) => {
						if (!record._hlc) {
							// Generate sequential HLC values for backfill
							const wall = wallMs.toString(36).padStart(11, "0");
							const cnt = (counter++).toString(16).padStart(4, "0");
							record._hlc = `${wall}:${cnt}:${origin}`;
						}
						if (record._deleted === undefined) record._deleted = false;
						if (!record._origin) record._origin = origin;
					});
				}
			});

		// V9: Radar — watch list + event log
		this.version(9).stores({
			radarWatches: "id, kind, targetId",
			radarEvents: "++id, watchId, kind, timestamp, [watchId+kind], acknowledged",
		});

		// V10: Manifest — local chain data cache
		this.version(10).stores({
			manifestCharacters: "id, characterItemId, name, suiAddress, tribeId, tenant, cachedAt",
			manifestTribes: "id, name, nameShort, tenant, cachedAt",
		});

		// V11: Character management — add source, tribeId, manifestId fields + backfill
		this.version(11)
			.stores({
				characters:
					"id, characterName, suiAddress, isActive, updatedAt, _hlc, source, manifestId, tenant",
			})
			.upgrade(async (tx) => {
				const characters = tx.table("characters");
				const manifest = tx.table("manifestCharacters");

				// Backfill source on existing characters
				await characters
					.toCollection()
					.modify((char: { source?: string; characterId?: string; suiAddress?: string }) => {
						if (!char.source) {
							char.source = char.characterId ? "log" : "manual";
						}
					});

				// Auto-link: match existing characters to manifest entries by characterItemId
				const allChars = await characters.toArray();
				for (const char of allChars) {
					if (char.characterId && !char.manifestId) {
						const match = await manifest.where("characterItemId").equals(char.characterId).first();
						if (match) {
							await characters.update(char.id, {
								manifestId: match.id,
								tribeId: match.tribeId || undefined,
								suiAddress: char.suiAddress || match.suiAddress || undefined,
							});
						}
					}
				}
			});

		// V12: Governance — organizations, tier members, claims, nicknames, currencies
		this.version(12).stores({
			organizations: "id, name, chainObjectId, creator, updatedAt, _hlc",
			orgTierMembers: "id, orgId, tier, kind, characterId, tribeId, [orgId+tier], _hlc",
			systemClaims: "id, orgId, systemId, status, weight, [systemId], updatedAt, _hlc",
			systemNicknames: "id, systemId",
			currencies: "id, orgId, symbol, packageId, treasuryCapId, updatedAt, _hlc",
		});

		// V13: Currency — add description, moduleName, orgTreasuryId + coinType index
		this.version(13)
			.stores({
				currencies: "id, orgId, symbol, coinType, packageId",
			})
			.upgrade(async (tx) => {
				await tx
					.table("currencies")
					.toCollection()
					.modify((c: { description?: string; moduleName?: string; orgTreasuryId?: string }) => {
						c.description = c.description ?? "";
						c.moduleName = c.moduleName ?? "";
						c.orgTreasuryId = c.orgTreasuryId ?? "";
					});
			});

		// V14: Trade — Trade Nodes table + orgMarketId on organizations (non-indexed)
		this.version(14).stores({
			tradeNodes: "id",
		});

		// V15: Deployables — add ownerCapId, assemblyModule, characterObjectId for on-chain rename
		this.version(15).stores({
			deployables:
				"id, objectId, assemblyType, owner, status, label, updatedAt, _hlc, ownerCapId, *tags",
		});

		// V16: Sonar — unified event log + channel state; backfill system_change from logEvents
		this.version(16)
			.stores({
				sonarEvents: "++id, [source+eventType], timestamp, characterId, assemblyId, sessionId",
				sonarState: "channel",
			})
			.upgrade(async (tx) => {
				const logEvents = tx.table("logEvents");
				const logSessions = tx.table("logSessions");
				const sonarEvents = tx.table("sonarEvents");
				const sonarState = tx.table("sonarState");

				// Initialize channel state
				await sonarState.bulkAdd([
					{ channel: "local", enabled: true, status: "off" },
					{ channel: "chain", enabled: true, status: "off" },
				]);

				// Backfill: copy existing system_change events from logEvents to sonarEvents
				const systemChanges = await logEvents.where("type").equals("system_change").toArray();

				if (systemChanges.length > 0) {
					const sessions = await logSessions.toArray();
					const sessionMap = new Map<string, { characterName: string; characterId?: string }>();
					for (const s of sessions) {
						sessionMap.set(s.id, {
							characterName: s.characterName,
							characterId: s.characterId,
						});
					}

					const sonarBatch = systemChanges.map(
						(le: { id?: number; sessionId: string; timestamp: string; systemName?: string }) => {
							const session = sessionMap.get(le.sessionId);
							return {
								timestamp: le.timestamp,
								source: "local" as const,
								eventType: "system_change" as const,
								characterName: session?.characterName,
								characterId: session?.characterId,
								systemName: le.systemName,
								details: le.systemName ? `Entered ${le.systemName}` : undefined,
								sessionId: le.sessionId,
							};
						},
					);

					await sonarEvents.bulkAdd(sonarBatch);

					const maxId = Math.max(...systemChanges.map((e: { id?: number }) => e.id ?? 0));
					await sonarState.update("local", { lastProcessedLogId: maxId });
				}
			});
		// V17: Parent node linking -- add parentId index to deployables + assemblies
		this.version(17).stores({
			deployables:
				"id, objectId, assemblyType, owner, status, label, updatedAt, _hlc, ownerCapId, parentId, *tags",
			assemblies: "id, assemblyType, objectId, owner, status, updatedAt, _hlc, parentId, *tags",
		});

		// V18: Celestials -- planet positions from mapObjects.db (lazy-loaded)
		this.version(18).stores({
			celestials: "id, systemId, typeId, index",
		});

		// V19: Structure locations -- add systemId index to deployables + assemblies
		this.version(19).stores({
			deployables:
				"id, objectId, assemblyType, owner, status, label, systemId, updatedAt, _hlc, ownerCapId, parentId, *tags",
			assemblies:
				"id, assemblyType, objectId, owner, status, systemId, updatedAt, _hlc, parentId, *tags",
		});

		// V20: Drop Radar tables -- Radar feature removed, replaced by Sonar
		this.version(20).stores({
			radarWatches: null,
			radarEvents: null,
		});

		// V21: Drop P2P sync tables -- P2P feature removed
		this.version(21).stores({
			syncPeers: null,
			syncLog: null,
			sharingGroups: null,
		});

		// V22: Market<T> replaces OrgTreasury -- currencies keyed by marketId, orgId removed
		this.version(22).stores({
			currencies: "id, symbol, coinType, packageId, marketId",
		});

		// V23: Manifest locations -- public structure locations from LocationRevealedEvent
		this.version(23).stores({
			manifestLocations: "id, solarsystem, typeId, tenant, cachedAt",
		});

		// V24: Private Maps -- encrypted location sharing cache
		this.version(24).stores({
			manifestPrivateMaps: "id, name, creator, tenant, cachedAt",
			manifestMapLocations:
				"id, mapId, solarSystemId, structureId, tenant, cachedAt, [mapId+locationId]",
		});

		// V25: Standings -- encrypted contact standings cache
		this.version(25).stores({
			manifestStandingsLists: "id, name, creator, tenant, cachedAt",
			manifestStandingEntries: "id, listId, kind, standing, tenant, [listId+kind]",
		});

		// V26: Contacts + Registry subscriptions -- plaintext standings model
		// Drop old encrypted standings tables (superseded by contacts + registries)
		this.version(26).stores({
			contacts: "id, kind, characterId, tribeId, standing, updatedAt",
			subscribedRegistries: "id, name, ticker, creator, tenant, subscribedAt",
			registryStandings: "id, registryId, kind, characterId, tribeId, [registryId+kind]",
			manifestStandingsLists: null,
			manifestStandingEntries: null,
		});
		// V27: Private Maps V2 -- dual-mode maps (encrypted + cleartext standings)
		this.version(27).stores({
			manifestPrivateMapsV2: "id, name, creator, mode, registryId, tenant, cachedAt",
		});

		// V28: Sonar Watchlist + enriched sonarEvents with sender/tribeId
		this.version(28).stores({
			sonarWatchlist: "id, kind, characterId, suiAddress, tribeId, updatedAt",
			sonarEvents:
				"++id, [source+eventType], timestamp, characterId, assemblyId, sessionId, sender, tribeId",
		});

		// V29: Structure extension configs (standings-based) + drop legacy permission tables
		this.version(29).stores({
			structureExtensionConfigs: "id, assemblyId, assemblyType, registryId",
			// Drop deprecated tables
			permissionGroups: null,
			groupMembers: null,
			assemblyPolicies: null,
			betrayalAlerts: null,
		});

		// V30: Manifest expansion -- markets, registries, private map index
		this.version(30).stores({
			manifestMarkets: "id, coinType, creator, cachedAt",
			manifestRegistries: "id, owner, name, ticker, cachedAt",
			manifestPrivateMapIndex: "id, creator, tenant, cachedAt",
		});

		// V31: Entity archival -- add _archived index for local hide/archive
		this.version(31).stores({
			currencies: "id, symbol, coinType, packageId, marketId, _archived",
			subscribedRegistries: "id, name, ticker, creator, tenant, subscribedAt, _archived",
			manifestPrivateMaps: "id, name, creator, tenant, cachedAt, _archived",
			manifestPrivateMapsV2: "id, name, creator, mode, registryId, tenant, cachedAt, _archived",
		});

		// V32: Treasury -- shared multi-user wallet for holding Coin<T> balances
		this.version(32).stores({
			treasuries: "id, owner",
		});
	}
}

export const db = new PeriscopeDB();

// Ensure sonarState seed records exist (V16 migration only runs on upgrade, not fresh installs)
db.on("ready", async () => {
	const count = await db.sonarState.count();
	if (count === 0) {
		await db.sonarState.bulkAdd([
			{ channel: "local", enabled: true, status: "off" },
			{ channel: "chain", enabled: true, status: "off" },
		]);
	}
});

/** Filter predicate to exclude soft-deleted records from queries */
export function notDeleted<T extends { _deleted?: boolean }>(record: T): boolean {
	return !record._deleted;
}

/** Filter predicate to exclude locally archived records from queries */
export function notArchived<T extends { _archived?: boolean }>(record: T): boolean {
	return !record._archived;
}
