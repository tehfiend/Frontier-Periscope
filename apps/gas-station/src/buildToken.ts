import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDynamicAllowedPackage } from "./config";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BuildTokenParams {
	symbol: string;
	name: string;
	description: string;
	decimals: number;
	senderAddress: string;
}

export interface BuildTokenResult {
	packageId: string;
	coinType: string;
	treasuryCapId: string;
	moduleName: string;
}

// ── Move Templates ───────────────────────────────────────────────────────────

function generateTokenSource(params: BuildTokenParams): string {
	const packageName = `${params.symbol.toLowerCase()}_token`;
	const moduleName = `${params.symbol.toUpperCase()}_TOKEN`;

	return `module ${packageName}::${moduleName};
use sui::coin;

public struct ${moduleName} has drop {}

fun init(witness: ${moduleName}, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        ${params.decimals},
        b"${params.symbol}",
        b"${params.name}",
        b"${params.description}",
        option::none(),
        ctx,
    );
    transfer::public_transfer(treasury, @${params.senderAddress});
    transfer::public_freeze_object(metadata);
}

/// Bootstrap mint — usable only while TreasuryCap is held by the creator.
/// After depositing TreasuryCap into OrgTreasury, this becomes uncallable.
public entry fun mint(
    treasury: &mut coin::TreasuryCap<${moduleName}>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let minted = coin::mint(treasury, amount, ctx);
    transfer::public_transfer(minted, recipient);
}

/// Bootstrap burn — usable only while TreasuryCap is held by the creator.
public entry fun burn(
    treasury: &mut coin::TreasuryCap<${moduleName}>,
    coin: coin::Coin<${moduleName}>,
) {
    coin::burn(treasury, coin);
}
`;
}

function generateTokenManifest(packageName: string): string {
	return `[package]
name = "${packageName}"
edition = "2024"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.66.2" }

[addresses]
${packageName} = "0x0"
`;
}

// ── Build Pipeline ───────────────────────────────────────────────────────────

/**
 * Generate, build, and publish a custom token Move package.
 *
 * 1. Generate Move source from params (string template substitution)
 * 2. Write to temp directory
 * 3. `sui move build`
 * 4. `sui client publish`
 * 5. Parse output for packageId, treasuryCapId, coinType
 * 6. Add packageId to dynamic whitelist
 * 7. Clean up temp directory
 */
export async function buildAndPublishToken(
	params: BuildTokenParams,
): Promise<BuildTokenResult> {
	const packageName = `${params.symbol.toLowerCase()}_token`;
	const moduleName = `${params.symbol.toUpperCase()}_TOKEN`;
	const tmpDir = mkdtempSync(join(tmpdir(), "token-build-"));

	try {
		// Generate source
		const source = generateTokenSource(params);
		const manifest = generateTokenManifest(packageName);

		// Write files
		const sourcesDir = join(tmpDir, "sources");
		mkdirSync(sourcesDir, { recursive: true });
		writeFileSync(join(tmpDir, "Move.toml"), manifest, "utf-8");
		writeFileSync(join(sourcesDir, `${moduleName}.move`), source, "utf-8");

		// Build
		execSync("sui move build", {
			cwd: tmpDir,
			stdio: "pipe",
			timeout: 60_000,
		});

		// Publish
		const publishOutput = execSync(
			"sui client publish --skip-dependency-verification --json",
			{
				cwd: tmpDir,
				stdio: "pipe",
				timeout: 120_000,
				encoding: "utf-8",
			},
		);

		// Parse results from publish output
		const parsed = JSON.parse(publishOutput);

		let packageId: string | undefined;
		let treasuryCapId: string | undefined;
		let coinType: string | undefined;

		if (parsed.objectChanges) {
			for (const change of parsed.objectChanges) {
				if (change.type === "published") {
					packageId = change.packageId;
				}
				if (
					change.type === "created" &&
					typeof change.objectType === "string" &&
					change.objectType.includes("::coin::TreasuryCap<")
				) {
					treasuryCapId = change.objectId;
					// Extract coinType from TreasuryCap<0xABC::MODULE::MODULE>
					const match = change.objectType.match(
						/::coin::TreasuryCap<(.+)>$/,
					);
					if (match) {
						coinType = match[1];
					}
				}
			}
		}

		// Fallback for packageId: check effects.created for immutable object
		if (!packageId && parsed.effects?.created) {
			for (const created of parsed.effects.created) {
				if (created.owner === "Immutable") {
					packageId = created.reference?.objectId ?? created.objectId;
					break;
				}
			}
		}

		if (!packageId) {
			throw new Error("Could not extract packageId from publish output");
		}
		if (!treasuryCapId) {
			throw new Error("Could not extract treasuryCapId from publish output");
		}
		if (!coinType) {
			throw new Error("Could not extract coinType from publish output");
		}

		// Whitelist the new package for sponsored transactions
		addDynamicAllowedPackage(packageId);

		return { packageId, coinType, treasuryCapId, moduleName };
	} finally {
		// Clean up temp directory
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup
		}
	}
}
