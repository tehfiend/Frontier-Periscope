import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { getPrivateKey, getAllowedPackageIds, SUI_GRAPHQL_URL } from "./config";

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

let _client: SuiGraphQLClient | null = null;

export function getSuiClient(): SuiGraphQLClient {
	if (!_client) {
		_client = new SuiGraphQLClient({ url: SUI_GRAPHQL_URL, network: "testnet" });
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

const GET_BALANCE = `
	query($owner: SuiAddress!) {
		address(address: $owner) {
			balance { totalBalance }
		}
	}
`;

interface GqlBalanceResponse {
	address: {
		balance: { totalBalance: string };
	} | null;
}

export async function getStationHealth() {
	const client = getSuiClient();
	const address = getStationAddress();

	try {
		const result = await client.query<GqlBalanceResponse, { owner: string }>({
			query: GET_BALANCE,
			variables: { owner: address },
		});
		const totalBalance = result.data?.address?.balance?.totalBalance ?? "0";
		return {
			status: "ok" as const,
			address,
			balance: totalBalance,
			balanceSui: (Number(totalBalance) / 1_000_000_000).toFixed(4),
		};
	} catch (err) {
		return {
			status: "error" as const,
			address,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
