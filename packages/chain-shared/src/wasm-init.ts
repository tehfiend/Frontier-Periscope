/**
 * Shared WASM initialization for @mysten/move-bytecode-template.
 *
 * Extracted from token-factory.ts and token-factory-standings.ts to avoid
 * duplicating the async init logic across multiple bytecode-patching modules.
 */

// WASM module -- needs async init before use
let wasmReady: Promise<void> | null = null;
let wasmMod: typeof import("@mysten/move-bytecode-template") | null = null;

/**
 * Ensure the @mysten/move-bytecode-template WASM module is initialized.
 * Safe to call multiple times -- subsequent calls return the cached module.
 */
export async function ensureWasmReady(): Promise<
	typeof import("@mysten/move-bytecode-template")
> {
	if (wasmMod) return wasmMod;
	if (!wasmReady) {
		wasmReady = (async () => {
			const mod = await import("@mysten/move-bytecode-template");
			if (typeof mod.default === "function") {
				await mod.default();
			}
			wasmMod = mod;
		})();
	}
	await wasmReady;
	return wasmMod!;
}
