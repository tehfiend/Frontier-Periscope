import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getPrivateKey, getAllowedPackageIds, SUI_RPC_URL } from "./config";
import { SuiClient } from "@mysten/sui/client";

// ── Keypair Management ──────────────────────────────────────────────────────

let _keypair: Ed25519Keypair | null = null;

export function getKeypair(): Ed25519Keypair {
	if (!_keypair) {
		_keypair = Ed25519Keypair.fromSecretKey(getPrivateKey());
	}
	return _keypair;
}

export function getStationAddress(): string {
	return getKeypair().toSuiAddress();
}

let _client: SuiClient | null = null;

export function getSuiClient(): SuiClient {
	if (!_client) {
		_client = new SuiClient({ url: SUI_RPC_URL });
	}
	return _client;
}

// ── Transaction Validation ──────────────────────────────────────────────────

/**
 * Validate that a transaction only calls allowed packages.
 * Parses the transaction bytes and checks all MoveCall commands.
 */
function validateTransaction(txBytes: Uint8Array): { valid: boolean; reason?: string } {
	const allowed = getAllowedPackageIds();

	try {
		const tx = Transaction.from(txBytes);
		const data = tx.getData();

		for (const command of data.commands) {
			if (command.$kind === "MoveCall" && command.MoveCall) {
				const target = command.MoveCall.package;
				if (!allowed.has(target)) {
					return {
						valid: false,
						reason: `Package ${target} is not in the allowed list`,
					};
				}
			}
		}

		return { valid: true };
	} catch (err) {
		return {
			valid: false,
			reason: `Failed to parse transaction: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

// ── Sponsor Signing ─────────────────────────────────────────────────────────

export interface SponsorResult {
	sponsorSignature: string;
}

/**
 * Validate and co-sign a transaction as the gas sponsor.
 *
 * The caller (Periscope) builds the transaction with the user as sender,
 * but sets the gas owner to our station wallet. We validate the transaction
 * only targets our packages, then sign with the station keypair.
 */
export async function sponsorTransaction(txBytesBase64: string): Promise<SponsorResult> {
	const txBytes = Buffer.from(txBytesBase64, "base64");
	const validation = validateTransaction(txBytes);

	if (!validation.valid) {
		throw new Error(`Transaction rejected: ${validation.reason}`);
	}

	const keypair = getKeypair();
	const { signature } = await keypair.signTransaction(txBytes);

	return { sponsorSignature: signature };
}

// ── Health Check ────────────────────────────────────────────────────────────

export async function getStationHealth() {
	const client = getSuiClient();
	const address = getStationAddress();

	try {
		const balance = await client.getBalance({ owner: address });
		return {
			status: "ok" as const,
			address,
			balance: balance.totalBalance,
			balanceSui: (Number(balance.totalBalance) / 1_000_000_000).toFixed(4),
		};
	} catch (err) {
		return {
			status: "error" as const,
			address,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
