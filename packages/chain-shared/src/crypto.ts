/**
 * Crypto utilities for the Private Map system.
 *
 * Provides wallet key derivation, X25519 key operations, and NaCl
 * sealed box encrypt/decrypt. All key material is derived deterministically
 * from wallet signatures -- no local key storage needed.
 *
 * Dependencies:
 * - @noble/hashes/sha2 -- SHA-256 for key derivation
 * - @noble/curves/ed25519 -- x25519 keygen, ed25519->x25519 conversion
 * - tweetnacl + tweetnacl-sealedbox-js -- NaCl sealed boxes
 * - @mysten/sui/cryptography -- parse Sui transaction signatures
 */

import { parseSerializedSignature } from "@mysten/sui/cryptography";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { open, seal } from "tweetnacl-sealedbox-js";

// ── Key Derivation ──────────────────────────────────────────────────────────

/** The message signed by the wallet to derive the map key. */
export const MAP_KEY_MESSAGE = "TehFrontier Map Key v1";

/**
 * Derive an X25519 keypair from a wallet signature (base64-encoded).
 *
 * The signature comes from `signPersonalMessage({ message: MAP_KEY_MESSAGE })`.
 * Ed25519 signatures are deterministic, so the same wallet always produces
 * the same derived key -- no local storage needed.
 *
 * Process: decode base64 signature -> SHA-256 hash -> x25519.keygen(hash)
 */
export function deriveMapKeyFromSignature(signatureBase64: string): {
	publicKey: Uint8Array;
	secretKey: Uint8Array;
} {
	// Parse the Sui serialized signature to get the raw signature bytes
	const parsed = parseSerializedSignature(signatureBase64);
	const hash = sha256(parsed.signature);
	// Use first 32 bytes as seed for X25519 keypair
	const seed = hash.slice(0, 32);
	const secretKey = seed;
	const publicKey = x25519.getPublicKey(secretKey);
	return { publicKey, secretKey };
}

/**
 * Generate an ephemeral X25519 keypair for new map creation.
 * Uses random seed (not deterministic).
 */
export function generateEphemeralX25519Keypair(): {
	publicKey: Uint8Array;
	secretKey: Uint8Array;
} {
	const secretKey = x25519.utils.randomSecretKey();
	const publicKey = x25519.getPublicKey(secretKey);
	return { publicKey, secretKey };
}

// ── Sealed Box Encryption ───────────────────────────────────────────────────

/**
 * Encrypt data using NaCl sealed box (anonymous sender).
 * Only the recipient's X25519 public key is needed.
 */
export function sealForRecipient(
	plaintext: Uint8Array,
	recipientPublicKey: Uint8Array,
): Uint8Array {
	return seal(plaintext, recipientPublicKey);
}

/**
 * Decrypt a NaCl sealed box message.
 * Requires the recipient's full keypair (public + secret).
 * Throws if decryption fails.
 */
export function unsealWithKey(
	ciphertext: Uint8Array,
	recipientPublicKey: Uint8Array,
	recipientSecretKey: Uint8Array,
): Uint8Array {
	const result = open(ciphertext, recipientPublicKey, recipientSecretKey);
	if (!result) {
		throw new Error("Sealed box decryption failed -- invalid key or corrupted ciphertext");
	}
	return result;
}

// ── Public Key Extraction ───────────────────────────────────────────────────

/**
 * GraphQL query to fetch a transaction signature for an address.
 * We only need one transaction -- any will do, since all contain the
 * signer's public key in the signature.
 */
const QUERY_TX_SIGNATURES = `
	query($addr: SuiAddress!, $first: Int) {
		address(address: $addr) {
			transactionBlocks(first: $first) {
				nodes {
					signatures
				}
			}
		}
	}
`;

interface GqlTxSignaturesResponse {
	address: {
		transactionBlocks: {
			nodes: Array<{
				signatures: string[];
			}>;
		};
	} | null;
}

/**
 * Extract the Ed25519 public key for a Sui address from their on-chain
 * transaction signatures, then convert it to X25519.
 *
 * Every Sui transaction contains the signer's public key in the serialized
 * signature. Any active player has at least one transaction (character creation).
 *
 * Throws if no transactions found or if the wallet uses a non-Ed25519 scheme.
 */
export async function getPublicKeyForAddress(
	client: SuiGraphQLClient,
	address: string,
): Promise<Uint8Array> {
	const result = await client.query<GqlTxSignaturesResponse, { addr: string; first: number }>({
		query: QUERY_TX_SIGNATURES,
		variables: { addr: address, first: 5 },
	});

	const txBlocks = result.data?.address?.transactionBlocks?.nodes ?? [];
	if (txBlocks.length === 0) {
		throw new Error(`No transactions found for address ${address}`);
	}

	// Try each transaction until we find an Ed25519 signature
	for (const tx of txBlocks) {
		for (const sigBase64 of tx.signatures ?? []) {
			try {
				const parsed = parseSerializedSignature(sigBase64);
				if (parsed.signatureScheme === "ED25519") {
					// Convert Ed25519 public key to X25519 using Montgomery form
					const ed25519PubKeyBytes = parsed.publicKey;
					const x25519PubKey = ed25519.utils.toMontgomery(ed25519PubKeyBytes);
					return x25519PubKey;
				}
			} catch {}
		}
	}

	throw new Error(
		`No Ed25519 signature found for address ${address}. Only Ed25519 wallets are supported for private maps.`,
	);
}

// ── Location Data Encoding ──────────────────────────────────────────────────

export interface LocationData {
	solarSystemId: number;
	planet: number;
	lPoint: number;
	description?: string;
}

/**
 * Encode location data to bytes for encryption.
 * JSON serialize + UTF-8 encode.
 */
export function encodeLocationData(data: LocationData): Uint8Array {
	const json = JSON.stringify(data);
	return new TextEncoder().encode(json);
}

/**
 * Decode location data from decrypted bytes.
 * UTF-8 decode + JSON parse.
 */
export function decodeLocationData(plaintext: Uint8Array): LocationData {
	const json = new TextDecoder().decode(plaintext);
	return JSON.parse(json) as LocationData;
}

// ── Hex Encoding Helpers ────────────────────────────────────────────────────

/** Convert a Uint8Array to a hex string. */
export function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Convert a hex string to a Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}
