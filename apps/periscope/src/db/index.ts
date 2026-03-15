import Dexie, { type EntityTable } from "dexie";
import type {
	SolarSystem,
	Constellation,
	Region,
	Jump,
	GameType,
	CharacterRecord,
	DeployableIntel,
	AssemblyIntel,
	PlayerIntel,
	LocationIntel,
	KillmailIntel,
	NoteIntel,
	ActivityIntel,
	ChatIntelEntry,
	TargetRecord,
	TargetEvent,
	InventoryDiff,
	SettingsEntry,
	CacheMetadataEntry,
	LogOffset,
	ExtensionRecord,
	LogEvent,
	LogSession,
	PermissionGroup,
	GroupMember,
	AssemblyPolicy,
	BetrayalAlert,
	SyncPeer,
	SyncLogEntry,
	SharingGroup,
	SyncMeta,
	RadarWatch,
	RadarEvent,
	ManifestCharacter,
	ManifestTribe,
	OrganizationRecord,
	OrgTierMember,
	SystemClaimRecord,
	SystemNickname,
	CurrencyRecord,
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

	// Characters
	characters!: EntityTable<CharacterRecord, "id">;

	// Intel tables
	deployables!: EntityTable<DeployableIntel, "id">;
	assemblies!: EntityTable<AssemblyIntel, "id">;
	players!: EntityTable<PlayerIntel, "id">;
	locations!: EntityTable<LocationIntel, "id">;
	killmails!: EntityTable<KillmailIntel, "id">;
	notes!: EntityTable<NoteIntel, "id">;
	activities!: EntityTable<ActivityIntel, "id">;
	chatIntel!: EntityTable<ChatIntelEntry, "id">;
	targets!: EntityTable<TargetRecord, "id">;
	targetEvents!: EntityTable<TargetEvent, "id">;
	inventoryDiffs!: EntityTable<InventoryDiff, "id">;

	// App state
	settings!: EntityTable<SettingsEntry, "key">;
	cacheMetadata!: EntityTable<CacheMetadataEntry, "key">;
	logOffsets!: EntityTable<LogOffset, "fileName">;

	// Extensions
	extensions!: EntityTable<ExtensionRecord, "id">;

	// Log analyzer
	logEvents!: EntityTable<LogEvent, "id">;
	logSessions!: EntityTable<LogSession, "id">;

	// Permissions
	permissionGroups!: EntityTable<PermissionGroup, "id">;
	groupMembers!: EntityTable<GroupMember, "id">;
	assemblyPolicies!: EntityTable<AssemblyPolicy, "id">;
	betrayalAlerts!: EntityTable<BetrayalAlert, "id">;

	// P2P Sync
	syncPeers!: EntityTable<SyncPeer, "id">;
	syncLog!: EntityTable<SyncLogEntry, "id">;
	sharingGroups!: EntityTable<SharingGroup, "id">;

	// Radar
	radarWatches!: EntityTable<RadarWatch, "id">;
	radarEvents!: EntityTable<RadarEvent, "id">;

	// Manifest (local chain cache)
	manifestCharacters!: EntityTable<ManifestCharacter, "id">;
	manifestTribes!: EntityTable<ManifestTribe, "id">;

	// Governance
	organizations!: EntityTable<OrganizationRecord, "id">;
	orgTierMembers!: EntityTable<OrgTierMember, "id">;
	systemClaims!: EntityTable<SystemClaimRecord, "id">;
	systemNicknames!: EntityTable<SystemNickname, "id">;
	currencies!: EntityTable<CurrencyRecord, "id">;

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
					const sessions = await logSessions
						.where("characterName")
						.equals(characterName)
						.toArray();
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

		// V8: P2P sync — new tables, _hlc indexes on all syncable tables, backfill sync fields
		this.version(8)
			.stores({
				// New sync tables
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
				chatIntel: "id, channel, reporter, systemId, createdAt, expiresAt, _hlc, *reportedPlayers, *tags",
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
					"deployables", "assemblies", "players", "locations", "killmails",
					"notes", "activities", "chatIntel", "targets", "targetEvents",
					"inventoryDiffs", "characters", "extensions", "permissionGroups",
					"groupMembers", "assemblyPolicies", "betrayalAlerts",
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
				characters: "id, characterName, suiAddress, isActive, updatedAt, _hlc, source, manifestId, tenant",
			})
			.upgrade(async (tx) => {
				const characters = tx.table("characters");
				const manifest = tx.table("manifestCharacters");

				// Backfill source on existing characters
				await characters.toCollection().modify((char: { source?: string; characterId?: string; suiAddress?: string }) => {
					if (!char.source) {
						char.source = char.characterId ? "log" : "manual";
					}
				});

				// Auto-link: match existing characters to manifest entries by characterItemId
				const allChars = await characters.toArray();
				for (const char of allChars) {
					if (char.characterId && !char.manifestId) {
						const match = await manifest
							.where("characterItemId")
							.equals(char.characterId)
							.first();
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
	}
}

export const db = new PeriscopeDB();

/** Filter predicate to exclude soft-deleted records from queries */
export function notDeleted<T extends { _deleted?: boolean }>(record: T): boolean {
	return !record._deleted;
}
