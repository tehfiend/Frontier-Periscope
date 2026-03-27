/**
 * Turret Factory -- Bytecode patcher for weights-only turret priority.
 *
 * Analogous to token-factory-standings.ts but for turret extensions.
 * Patches pre-compiled turret_priority bytecodes with user-configured
 * weight constants via @mysten/move-bytecode-template.
 *
 * The compiled bytecodes contain sentinel u64 values (1000001-1000009) that
 * are replaced with actual weight/class values at publish time. Friend/foe
 * lists are hardcoded to empty (all slots = 0), so targeting is driven
 * entirely by weight constants.
 *
 * Standings-based turret targeting is deferred until CCP adds runtime
 * config support to turret world contracts.
 */

import { bcs } from "@mysten/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { DEFAULT_TURRET_PRIORITY_CONFIG, SHIP_CLASSES } from "./turret-priority";
import { ensureWasmReady } from "./wasm-init";

// Re-export for convenience so the app can import from @tehfrontier/chain-shared
export { DEFAULT_TURRET_PRIORITY_CONFIG, SHIP_CLASSES };

/**
 * Pre-compiled turret_priority bytecodes (base64).
 *
 * Compiled from generateTurretPrioritySource() with these sentinels:
 *   defaultWeight: 1000001, kosWeight: 1000002, aggressorBonus: 1000003,
 *   betrayalBonus: 1000004, lowHpBonus: 1000005, lowHpThreshold: 1000006,
 *   classBonus: 1000007, effectiveClasses: [1000008, 1000009]
 *   friendlyTribes: [], friendlyCharacters: [], kosTribes: [], kosCharacters: [] (all empty)
 *
 * Built against world-contracts v0.0.21 with `sui move build --build-env testnet`.
 */
// prettier-ignore -- base64 bytecodes must stay on one line
const TURRET_TEMPLATE_BYTECODES_B64 =
	"oRzrCwYAAAAKAQAMAgwgAyxeBIoBCAWSAXEHgwLXAwjaBWAGugaTAQrNBw0M2gfvCQAgAQgBDwEbAgkCHgAHAgAAAwMAAwEHAAQACAAFAgAABQQHAAUFBwAFBggAABAAAQAAFgIDAAAVAgMAABgCAwAAFwIDAAAUBAMAAR0KAQEAAg4UBgEDAxIKCAEIBQoOAgAFCw4CAAUMEgYBAgURDgQABRMOAwAFGQ4EAAUaDwwABR8HCAAFIQELAAgJBhALEQcTBAYIBwYIAwoCCAQBCgIBDgEBAQMPAQEBAQYIBgoIBg4OAwMBAwoCCggFAwABBggEAQgCAQgHAQYJAAEKCAYBCAUBCAYBBggGAgMDAQoIBQEIAAIIBAkAAQgBAQkACQEBAQEBAQEBAQUBAQEBAQMBAQEJQ2hhcmFjdGVyAklEDU9ubGluZVJlY2VpcHQYUHJpb3JpdHlMaXN0VXBkYXRlZEV2ZW50GFJldHVyblRhcmdldFByaW9yaXR5TGlzdA9UYXJnZXRDYW5kaWRhdGUGVHVycmV0ElR1cnJldFByaW9yaXR5QXV0aANiY3MJY2hhcmFjdGVyDGNoYXJhY3Rlcl9pZA9jaGFyYWN0ZXJfdHJpYmUWZGVzdHJveV9vbmxpbmVfcmVjZWlwdAtkdW1teV9maWVsZARlbWl0BWV2ZW50GGdldF90YXJnZXRfcHJpb3JpdHlfbGlzdAhncm91cF9pZAJpZAxpc19hZ2dyZXNzb3ISaXNfZWZmZWN0aXZlX2NsYXNzFWlzX2ZyaWVuZGx5X2NoYXJhY3RlchFpc19mcmllbmRseV90cmliZRBpc19rb3NfY2hhcmFjdGVyDGlzX2tvc190cmliZQdpdGVtX2lkH25ld19yZXR1cm5fdGFyZ2V0X3ByaW9yaXR5X2xpc3QGb2JqZWN0DHRhcmdldF9jb3VudAh0b19ieXRlcwZ0dXJyZXQJdHVycmV0X2lkD3R1cnJldF9wcmlvcml0eRV1bnBhY2tfY2FuZGlkYXRlX2xpc3QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkg5XfhvweLrRk4WqqC5zMu+StJc9z4U0eXsSn5gU1jEKAhYVRUludmFsaWRPbmxpbmVSZWNlaXB0CgIXFkludmFsaWQgb25saW5lIHJlY2VpcHQDCEFCDwAAAAAAAwhCQg8AAAAAAAMIQ0IPAAAAAAADCERCDwAAAAAAAwhFQg8AAAAAAAMIRkIPAAAAAAADCEdCDwAAAAAADgQAAAAAAwhIQg8AAAAAAAMISUIPAAAAAAAAAgENAQECAh8IAhwDAAEAAAWZAQ4DERAKADgAIQQHBQsLAAEGAQAAAFAAAMAnCwIREQwJQAwAAAAAAAAAAAwRBgAAAAAAAAAADA0OCUENDA8KDQoPIwSLAQ4JCg1CDQwICggRCgwLCggRCQwKCggRDAwMCgsRAQQtBSoIDAQFMAoKEQIMBAsEDA4KDgQ5CggRDSAMBQU7CQwFCwUESA0RCwgRDgYAAAAAAAAAABEPRAwLDQYBAAAAAAAAABYMDQUVBwIMEgsOBFAKCBENDAYFUgkMBgsGBGUHAwcEFgcFFgwSDRELCBEOCxIRD0QMCw0GAQAAAAAAAAAWDA0FFQsLEQMEawgMBwVuCwoRBAwHCwcEcgcDDBIKCBENBHkLEgcEFgwSCwwRBQSAAQsSBwgWDBINEQsIEQ4LEhEPRAwLDQYBAAAAAAAAABYMDQUVDhE4AQwQCwMJEgA4AgsAOAALDxIBOAMLEAIBAAAAFYUBCgBJAAAAACEEBgkCBwlJAAAAACIEDwoABwkhDAkFEQkMCQsJBBYIDAEFgwEHCUkAAAAAIgQfCgAHCSEMCAUhCQwICwgEJggMAQWDAQcJSQAAAAAiBC8KAAcJIQwHBTEJDAcLBwQ2CAwBBYMBBwlJAAAAACIEPwoABwkhDAYFQQkMBgsGBEYIDAEFgwEHCUkAAAAAIgRPCgAHCSEMBQVRCQwFCwUEVggMAQWDAQcJSQAAAAAiBF8KAAcJIQwEBWEJDAQLBARmCAwBBYMBBwlJAAAAACIEbwoABwkhDAMFcQkMAwsDBHYIDAEFgwEHCUkAAAAAIgR/CwAHCSEMAgWBAQkMAgsCDAELAQICAAAAFYUBCgBJAAAAACEEBgkCBwlJAAAAACIEDwoABwkhDAkFEQkMCQsJBBYIDAEFgwEHCUkAAAAAIgQfCgAHCSEMCAUhCQwICwgEJggMAQWDAQcJSQAAAAAiBC8KAAcJIQwHBTEJDAcLBwQ2CAwBBYMBBwlJAAAAACIEPwoABwkhDAYFQQkMBgsGBEYIDAEFgwEHCUkAAAAAIgRPCgAHCSEMBQVRCQwFCwUEVggMAQWDAQcJSQAAAAAiBF8KAAcJIQwEBWEJDAQLBARmCAwBBYMBBwlJAAAAACIEbwoABwkhDAMFcQkMAwsDBHYIDAEFgwEHCUkAAAAAIgR/CwAHCSEMAgWBAQkMAgsCDAELAQIDAAAAFkUKAEkAAAAAIQQGCQIHCUkAAAAAIgQPCgAHCSEMBQURCQwFCwUEFggMAQVDBwlJAAAAACIEHwoABwkhDAQFIQkMBAsEBCYIDAEFQwcJSQAAAAAiBC8KAAcJIQwDBTEJDAMLAwQ2CAwBBUMHCUkAAAAAIgQ/CwAHCSEMAgVBCQwCCwIMAQsBAgQAAAAWRQoASQAAAAAhBAYJAgcJSQAAAAAiBA8KAAcJIQwFBREJDAULBQQWCAwBBUMHCUkAAAAAIgQfCgAHCSEMBAUhCQwECwQEJggMAQVDBwlJAAAAACIELwoABwkhDAMFMQkMAwsDBDYIDAEFQwcJSQAAAAAiBD8LAAcJIQwCBUEJDAILAgwBCwECBQAAABclCgAGAAAAAAAAAAAhBAYJAgcKBgAAAAAAAAAAIgQPCgAHCiEMAwURCQwDCwMEFggMAQUjBwsGAAAAAAAAAAAiBB8LAAcLIQwCBSEJDAILAgwBCwECAA==";

// ── Sentinel values ─────────────────────────────────────────────────────────
// These must match the values baked into the pre-compiled bytecodes.

const SENTINEL_DEFAULT_WEIGHT = 1000001n;
const SENTINEL_KOS_WEIGHT = 1000002n;
const SENTINEL_AGGRESSOR_BONUS = 1000003n;
const SENTINEL_BETRAYAL_BONUS = 1000004n;
const SENTINEL_LOW_HP_BONUS = 1000005n;
const SENTINEL_LOW_HP_THRESHOLD = 1000006n;
const SENTINEL_CLASS_BONUS = 1000007n;
const SENTINEL_EFFECTIVE_CLASS_0 = 1000008n;
const SENTINEL_EFFECTIVE_CLASS_1 = 1000009n;

function getTemplateBytecodes(): Uint8Array {
	if (!TURRET_TEMPLATE_BYTECODES_B64) {
		throw new Error(
			"turret_priority bytecodes not yet embedded. " +
				"Build the contract first and update TURRET_TEMPLATE_BYTECODES_B64.",
		);
	}
	const binaryStr = atob(TURRET_TEMPLATE_BYTECODES_B64);
	const bytes = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) {
		bytes[i] = binaryStr.charCodeAt(i);
	}
	return bytes;
}

/** BCS-encode a u64 value for constant patching. */
function bcsU64(n: bigint | number): Uint8Array {
	return bcs.u64().serialize(BigInt(n)).toBytes();
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface TurretWeightsParams {
	/** Optional module name suffix, e.g. "ALPHA" -> "turret_priority_alpha" */
	symbol?: string;
	/** Base weight for unlisted targets (0-255) */
	defaultWeight: number;
	/** Weight for KOS targets (0-255) */
	kosWeight: number;
	/** Bonus weight when target is actively attacking (0-255) */
	aggressorBonus: number;
	/** Bonus for friendly attacker -- traitor/spy gets maximum priority (0-255) */
	betrayalBonus: number;
	/** Bonus weight when target HP is below threshold (0-255) */
	lowHpBonus: number;
	/** HP threshold (0-100) for low HP bonus */
	lowHpThreshold: number;
	/** Bonus weight for effective ship class match (0-255) */
	classBonus: number;
	/** Ship class group IDs this turret is effective against (0 = disabled) */
	effectiveClasses: [number, number];
}

export interface PublishTurretResult {
	packageId: string;
	moduleName: string;
}

/**
 * Build a transaction to publish a weights-only turret priority extension.
 *
 * Uses @mysten/move-bytecode-template to patch the pre-compiled
 * turret_priority module with user-configured weight constants.
 * The user signs with their wallet -- no CLI or compile step needed.
 *
 * @param params - Turret weight parameters
 * @param worldPackageId - Published world contracts package ID (dependency)
 * @returns Transaction and effective module name for witness type construction
 */
export async function buildPublishTurret(
	params: TurretWeightsParams,
	worldPackageId: string,
): Promise<{ tx: Transaction; moduleName: string }> {
	const {
		symbol,
		defaultWeight,
		kosWeight,
		aggressorBonus,
		betrayalBonus,
		lowHpBonus,
		lowHpThreshold,
		classBonus,
		effectiveClasses,
	} = params;

	const mod = await ensureWasmReady();

	let bytecodes = getTemplateBytecodes();

	// Determine effective module name
	const moduleName = symbol ? `turret_priority_${symbol.toLowerCase()}` : "turret_priority";

	// 1. Optionally patch identifiers if a custom symbol is provided
	if (symbol) {
		bytecodes = new Uint8Array(
			mod.update_identifiers(bytecodes, {
				turret_priority: moduleName,
			}),
		);
	}

	// 2. Patch u64 sentinel constants with actual weight values
	// Each sentinel is a unique u64 value that appears exactly once in the bytecodes.

	// DEFAULT_WEIGHT: sentinel 1000001 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(bytecodes, bcsU64(defaultWeight), bcsU64(SENTINEL_DEFAULT_WEIGHT), "U64"),
	);

	// KOS_WEIGHT: sentinel 1000002 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(bytecodes, bcsU64(kosWeight), bcsU64(SENTINEL_KOS_WEIGHT), "U64"),
	);

	// AGGRESSOR_BONUS: sentinel 1000003 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcsU64(aggressorBonus),
			bcsU64(SENTINEL_AGGRESSOR_BONUS),
			"U64",
		),
	);

	// BETRAYAL_BONUS: sentinel 1000004 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(bytecodes, bcsU64(betrayalBonus), bcsU64(SENTINEL_BETRAYAL_BONUS), "U64"),
	);

	// LOW_HP_BONUS: sentinel 1000005 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(bytecodes, bcsU64(lowHpBonus), bcsU64(SENTINEL_LOW_HP_BONUS), "U64"),
	);

	// LOW_HP_THRESHOLD: sentinel 1000006 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcsU64(lowHpThreshold),
			bcsU64(SENTINEL_LOW_HP_THRESHOLD),
			"U64",
		),
	);

	// CLASS_BONUS: sentinel 1000007 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(bytecodes, bcsU64(classBonus), bcsU64(SENTINEL_CLASS_BONUS), "U64"),
	);

	// EFFECTIVE_CLASS_0: sentinel 1000008 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcsU64(effectiveClasses[0]),
			bcsU64(SENTINEL_EFFECTIVE_CLASS_0),
			"U64",
		),
	);

	// EFFECTIVE_CLASS_1: sentinel 1000009 -> actual value
	bytecodes = new Uint8Array(
		mod.update_constants(
			bytecodes,
			bcsU64(effectiveClasses[1]),
			bcsU64(SENTINEL_EFFECTIVE_CLASS_1),
			"U64",
		),
	);

	// 3. Build publish transaction
	const tx = new Transaction();

	const [upgradeCap] = tx.publish({
		modules: [Array.from(bytecodes)],
		dependencies: [
			"0x1", // Move stdlib
			"0x2", // Sui framework
			worldPackageId, // world contracts
		],
	});

	// Transfer UpgradeCap to sender (they can discard it later if desired)
	tx.transferObjects([upgradeCap], tx.pure.address("0x0")); // placeholder, replaced by sender

	return { tx, moduleName };
}

/**
 * Parse publish transaction results to extract the turret package ID.
 *
 * Simpler than token-factory -- no Market object to find, just the
 * published package ID and module name.
 */
export function parsePublishTurretResult(
	objectChanges: Array<{
		type: string;
		packageId?: string;
		objectType?: string;
		objectId?: string;
	}>,
): PublishTurretResult | null {
	let packageId = "";
	let moduleName = "";

	for (const change of objectChanges) {
		if (change.type === "published" && change.packageId) {
			packageId = change.packageId;
			const modules = (change as Record<string, unknown>).modules as string[] | undefined;
			if (modules?.[0]) {
				moduleName = modules[0];
			}
		}
	}

	if (!packageId) return null;

	return { packageId, moduleName };
}
