import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { db } from "@/db";
import {
	ENCRYPTION_KEY_MESSAGE,
	bytesToHex,
	deriveMapKeyFromSignature,
	hexToBytes,
} from "@tehfrontier/chain-shared";

// ── Stored Encryption Key Hook ──────────────────────────────────────────────

/**
 * Load the encryption keypair for the connected wallet address.
 * Stored permanently in settings keyed by wallet address.
 * If wallet is connected and key not yet stored, auto-derives it
 * (one-time transparent sign) and persists permanently.
 *
 * Used by both Private Maps and Standings for X25519 encryption.
 */
export function useStoredEncryptionKey(): {
	keyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null;
	isLoading: boolean;
	retry: () => void;
	reset: () => Promise<void>;
} {
	const dAppKit = useDAppKit();
	const account = useCurrentAccount();
	const walletAddress = account?.address;

	const [keyPair, setKeyPair] = useState<{
		publicKey: Uint8Array;
		secretKey: Uint8Array;
	} | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const attemptedRef = useRef<string | null>(null);
	const [retryCount, setRetryCount] = useState(0);

	const retry = useCallback(() => {
		attemptedRef.current = null;
		setRetryCount((c) => c + 1);
	}, []);

	/** Delete stored key and force re-derivation from a fresh wallet signature. */
	const reset = useCallback(async () => {
		if (!walletAddress) return;
		await db.settings.delete(`mapKey:${walletAddress}`);
		setKeyPair(null);
		attemptedRef.current = null;
		setRetryCount((c) => c + 1);
	}, [walletAddress]);

	useEffect(() => {
		if (!walletAddress) {
			setKeyPair(null);
			attemptedRef.current = null;
			return;
		}

		// Don't re-attempt for the same address
		if (attemptedRef.current === walletAddress) return;
		attemptedRef.current = walletAddress;

		let cancelled = false;
		const settingsKey = `mapKey:${walletAddress}`;

		async function loadKey() {
			setIsLoading(true);
			try {
				// Check if key is already stored
				const stored = await db.settings.get(settingsKey);
				if (cancelled) return;

				if (stored?.value) {
					const { publicHex, secretHex } = stored.value as {
						publicHex: string;
						secretHex: string;
					};
					if (publicHex && secretHex) {
						setKeyPair({
							publicKey: hexToBytes(publicHex),
							secretKey: hexToBytes(secretHex),
						});
						return;
					}
				}

				// Not stored -- derive from wallet signature (one-time)
				// Retry on "Max epoch" errors (SDK needs time to fetch epoch data)
				let signature: string;
				for (let attempt = 0; ; attempt++) {
					try {
						const result = await dAppKit.signPersonalMessage({
							message: new TextEncoder().encode(ENCRYPTION_KEY_MESSAGE),
						});
						signature = result.signature;
						break;
					} catch (err) {
						if (attempt < 3 && String(err).includes("Max epoch")) {
							await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
							if (cancelled) return;
							continue;
						}
						throw err;
					}
				}
				if (cancelled) return;

				const derived = deriveMapKeyFromSignature(signature);

				// Store permanently
				await db.settings.put({
					key: settingsKey,
					value: {
						publicHex: bytesToHex(derived.publicKey),
						secretHex: bytesToHex(derived.secretKey),
					},
				});

				if (!cancelled) {
					setKeyPair(derived);
				}
			} catch (err) {
				// Reset so user can retry (via disconnect/reconnect or retry button)
				if (!cancelled) attemptedRef.current = null;

				if (String(err).includes("Max epoch")) {
					alert(
						"Eve Vault error: Max epoch is not set.\n\n" +
							"Try logging out of the Eve Vault extension and logging back in, " +
							"then reconnect your wallet.",
					);
				}
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		}

		loadKey();
		return () => {
			cancelled = true;
		};
	}, [walletAddress, dAppKit, retryCount]);

	return { keyPair, isLoading, retry, reset };
}
