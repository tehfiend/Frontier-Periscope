/**
 * Crypto utilities for encrypted on-chain features (Private Maps, Standings).
 *
 * Provides wallet key derivation, X25519 key operations, and NaCl
 * sealed box encrypt/decrypt. All key material is derived deterministically
 * from wallet signatures -- no local key storage needed.
 *
 * Dependencies:
 * - @noble/hashes/sha2 -- SHA-256 for key derivation
 * - @noble/curves/ed25519 -- x25519 keygen
 * - tweetnacl + tweetnacl-sealedbox-js -- NaCl sealed boxes
 * - @mysten/sui/cryptography -- parse Sui transaction signatures
 */

import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
// @ts-ignore -- consumers can't resolve src/types/tweetnacl-sealedbox-js.d.ts
import { open, seal } from "tweetnacl-sealedbox-js";

// ── Key Derivation ──────────────────────────────────────────────────────────

/** The message signed by the wallet to derive the encryption keypair. */
export const ENCRYPTION_KEY_MESSAGE = "Frontier Periscope Encryption Key v1";

/**
 * Derive an X25519 keypair from a wallet signature (base64-encoded).
 *
 * The signature comes from `signPersonalMessage({ message: ENCRYPTION_KEY_MESSAGE })`.
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
	if (!parsed.signature) {
		throw new Error("No signature bytes found in serialized signature");
	}
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
