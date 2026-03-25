// AES-256-GCM encryption with PBKDF2 key derivation (WebCrypto API)

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 600_000;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder().encode(passphrase);
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.buffer as ArrayBuffer,
		"PBKDF2",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/** Encrypt a string. Returns base64-encoded salt + iv + ciphertext. */
export async function encrypt(plaintext: string, passphrase: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const key = await deriveKey(passphrase, salt);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(plaintext),
	);
	// Pack: salt (16) + iv (12) + ciphertext
	const packed = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
	packed.set(salt, 0);
	packed.set(iv, salt.length);
	packed.set(new Uint8Array(ciphertext), salt.length + iv.length);
	// Chunked conversion avoids stack overflow for large payloads (spread operator limit ~100KB)
	let binary = "";
	for (let i = 0; i < packed.length; i++) binary += String.fromCharCode(packed[i]);
	return btoa(binary);
}

/** Decrypt a base64 string produced by encrypt(). */
export async function decrypt(encoded: string, passphrase: string): Promise<string> {
	const packed = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
	const salt = packed.slice(0, SALT_LENGTH);
	const iv = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
	const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH);
	const key = await deriveKey(passphrase, salt);
	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);
	return new TextDecoder().decode(decrypted);
}

/** Quick test: encrypt then decrypt a known string. Returns true if passphrase is valid. */
export async function verifyPassphrase(passphrase: string, testCiphertext: string): Promise<boolean> {
	try {
		await decrypt(testCiphertext, passphrase);
		return true;
	} catch {
		return false;
	}
}
