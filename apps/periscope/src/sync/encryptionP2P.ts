// Group key AES-256-GCM encryption for intel peer sharing
// Uses raw keys (no PBKDF2) — keys are generated and shared directly

const IV_LENGTH = 12;

/** Generate a new AES-256 group key as base64 */
export async function generateGroupKey(): Promise<string> {
	const key = await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"],
	);
	const raw = await crypto.subtle.exportKey("raw", key);
	let binary = "";
	const bytes = new Uint8Array(raw);
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/** Import a base64-encoded raw AES-256 key */
export async function importGroupKey(base64: string): Promise<CryptoKey> {
	const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey(
		"raw",
		raw.buffer as ArrayBuffer,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

/** Encrypt a payload with a group key. Returns base64(iv + ciphertext). */
export async function encryptPayload(data: string, key: CryptoKey): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		new TextEncoder().encode(data),
	);
	const packed = new Uint8Array(iv.length + ciphertext.byteLength);
	packed.set(iv, 0);
	packed.set(new Uint8Array(ciphertext), iv.length);
	let binary = "";
	for (let i = 0; i < packed.length; i++) binary += String.fromCharCode(packed[i]);
	return btoa(binary);
}

/** Decrypt a payload encrypted with encryptPayload(). */
export async function decryptPayload(encoded: string, key: CryptoKey): Promise<string> {
	const packed = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
	const iv = packed.slice(0, IV_LENGTH);
	const ciphertext = packed.slice(IV_LENGTH);
	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		ciphertext,
	);
	return new TextDecoder().decode(decrypted);
}
