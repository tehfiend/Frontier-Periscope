# EVE Frontier In-Game Browser Reference

## Engine

**CEF (Chromium Embedded Framework) 122.1.9** based on **Chromium 122.0.6261.94** (Feb 2024)

Found at: `{gameRoot}/utopia/bin64/cef/libcef.dll`

Full CEF distribution with locales, V8 snapshots, Vulkan SwiftShader, and `ccpcef.exe` launcher.

## Supported Features (Chromium 122)

### JavaScript / ECMAScript
- ES2022+ (top-level await, `.at()`, `structuredClone`, `Object.hasOwn`)
- `Promise.withResolvers()` (added Chrome 119)
- Private class fields/methods
- `Array.findLast()` / `Array.findLastIndex()`
- Temporal -- NOT supported (still behind flag)

### CSS
- CSS Nesting (native)
- CSS Container Queries (`@container`)
- CSS `:has()` selector
- CSS Subgrid
- `color-mix()`
- `@layer` (cascade layers)
- `@property` (registered custom properties)
- `lh` / `rlh` units
- Scroll-driven animations (added Chrome 115)

### Web APIs
- IndexedDB
- WebCrypto (AES-GCM, PBKDF2, etc.)
- Fetch API
- WebSocket
- Service Workers
- Web Workers
- ResizeObserver
- IntersectionObserver
- Popover API
- View Transitions API
- WebGPU
- `dialog` element
- `window.open()` (popups for EVE Vault wallet)
- `postMessage` (cross-window communication for wallet)
- File System Access API (used by Periscope for log file access)

### Not Supported / Partial
- `@starting-style` -- partial (full support in Chrome 124)
- Temporal API -- behind flag, not usable
- `Set.union()` / `Set.intersection()` -- landed in 122 but may be unstable
- Declarative Shadow DOM streaming -- added in 124

## dApp Loading

- Player presses **F** on a smart assembly in-game
- Game client opens CEF browser to the assembly's configured dApp URL
- URL format: `https://dapps.evefrontier.com/?tenant={tenant}&itemId={itemId}`
- Custom dApp URLs can be set via assembly metadata on-chain
- dApps also work in external browsers (Chrome, Edge, Firefox)

## Wallet Integration

- **EVE Vault** (slush wallet via `vault.evefrontier.com`) -- uses `window.open()` popup + `postMessage`
- **MetaMask** -- EIP-6963 injected provider discovery
- Connected via `@mysten/dapp-kit-react` with `slushWalletConfig`

## Our dApp Stack Compatibility

| Technology | Compatible | Notes |
|-----------|------------|-------|
| React 19 | Yes | |
| Tailwind CSS v4 | Yes | CSS nesting + `:has()` supported |
| Vite (ES2022 target) | Yes | |
| `@tanstack/react-query` | Yes | |
| `@mysten/dapp-kit-react` | Yes | |
| IndexedDB (Dexie.js) | Yes | |
| GraphQL fetch | Yes | |
| `@noble/hashes` (blake2b) | Yes | |

No polyfills required. All features used by our dApps are fully supported in Chromium 122.

## Version Check Command

```powershell
(Get-Item 'C:\CCP\EVE Frontier\utopia\bin64\cef\libcef.dll').VersionInfo.ProductVersion
```
