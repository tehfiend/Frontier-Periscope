declare module "tweetnacl-sealedbox-js" {
	/**
	 * Encrypt a message using a sealed box (anonymous sender).
	 * Uses X25519 + XSalsa20-Poly1305.
	 */
	export function seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;

	/**
	 * Decrypt a sealed box message.
	 * Returns the plaintext, or null if decryption fails.
	 */
	export function open(
		ciphertext: Uint8Array,
		recipientPublicKey: Uint8Array,
		recipientSecretKey: Uint8Array,
	): Uint8Array | null;

	/** Overhead in bytes added by sealed box encryption (48 bytes). */
	export const overheadLength: number;
}
