# Plan: App Versioning and Changelog System
**Status:** Ready
**Created:** 2026-03-26
**Module:** periscope

## Overview

Frontier Periscope currently has no user-facing version identifier. The only version is the `0.0.1` in `package.json`, which is npm plumbing and not meaningful to end users. We need a display version format that communicates release freshness at a glance: `R.YY.MM.DD` (e.g., `1.26.03.26`), where `R` is a manually-bumped release number and the date portion reflects the version's creation date.

The version string will be injected at build time via Vite's `define` option so it is compiled into the bundle as a string literal -- no runtime lookups, no extra network requests. This is the simplest approach that gives us a display version completely decoupled from `package.json` semver.

Alongside the version, we will add a changelog system so users can see what changed between versions. The changelog should be easy to author (structured data, not freeform markdown) and easy to render (a modal accessible from the sidebar and from the "What's New" prompt after updates). The PWA update prompt already exists in `PWAPrompt.tsx`; the "What's New" modal after reload will handle communicating version details to the user.

## Current State

- **package.json version**: `0.0.1` at `apps/periscope/package.json` -- npm plumbing only.
- **Vite config**: `apps/periscope/vite.config.ts` -- uses `defineConfig` with no `define` block currently. Supports `@` path alias.
- **PWA prompt**: `apps/periscope/src/components/PWAPrompt.tsx` -- shows "New version available" with an Update button when the service worker detects new content. No version number is displayed.
- **Sidebar**: `apps/periscope/src/components/Sidebar.tsx` -- has a footer section (lines 194-204) with only a collapse toggle button. No version display.
- **Settings page**: `apps/periscope/src/views/Settings.tsx` -- comprehensive settings view with sections for Server, Characters, Game Logs, Static Data, Game Types (World API), Backup, and Danger Zone. No "About" section or version display.
- **App store**: `apps/periscope/src/stores/appStore.ts` -- Zustand store managing UI state. No version-related state.
- **Constants**: `apps/periscope/src/lib/constants.ts` -- shared constants file. No version constant.
- **No existing version file, changelog file, or "what's new" mechanism.**
- **Dialog pattern**: The app uses inline modal patterns (e.g., `AddCharacterDialog.tsx` renders its own backdrop/overlay). No shared dialog component.

## Target State

### Version System

A single source-of-truth file (`apps/periscope/src/version.ts`) exports the display version and changelog data. Vite's `define` injects `__APP_VERSION__` at build time from this file. The version is visible in:

1. **Sidebar footer** -- small muted text below the collapse button (e.g., `v1.26.03.26`)
2. **Settings page** -- an "About" section at the bottom showing the full version
3. **Changelog modal** -- accessible from sidebar version click and Settings "About" section
4. **"What's New" modal** -- auto-shows after a version update with changes since last visit

### Changelog System

Changelog entries are authored as a TypeScript array in `version.ts`, co-located with the version string. Each entry has a version, date, and array of categorized changes. This keeps the changelog type-safe, avoids runtime parsing, and makes it trivial to tree-shake old entries in the future.

### "What's New" Prompt

On first visit after a version change, a "What's New" modal auto-shows with all changelog entries newer than the user's last-seen version. The previously-seen version is stored in `localStorage` (simple string comparison -- no IndexedDB overhead needed for this).

### Data Model

```ts
interface ChangelogEntry {
  version: string;       // "1.26.03.26"
  date: string;          // "2026-03-26"
  highlights?: string;   // Optional one-liner shown as subtitle in the changelog/What's New modal
  changes: {
    category: "added" | "changed" | "fixed" | "removed";
    description: string;
  }[];
}
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Version source of truth | `version.ts` file with const exports | Co-locates version + changelog, type-safe, importable by both Vite config and app code |
| Build-time injection | Vite `define` with `__APP_VERSION__` | Zero runtime cost, works in all contexts including PWA prompt |
| Changelog format | TypeScript array of `ChangelogEntry` | Type-safe, no parsing needed, easy to author, tree-shakeable |
| Changelog display | Modal component (not a route) | Lightweight, accessible from anywhere, doesn't need URL routing |
| "What's New" trigger | `localStorage` key comparing last-seen version | Simple, synchronous read on startup, no DB migration needed |
| Version in sidebar | Clickable text that opens changelog modal | Discoverable, unobtrusive, uses existing sidebar footer area |
| `package.json` version | Stays `0.0.1` (or semver as needed) | Decoupled from display version -- `package.json` is npm plumbing |
| PWA update prompt version | No version in the update prompt | Keep the prompt simple ("New update available"); the "What's New" modal after reload communicates version details, avoiding old/new version confusion |
| "What's New" filtering | Show all entries newer than last-seen version | Users who skip multiple versions see everything they missed; CHANGELOG is expected to stay short for a solo-dev tool |

## Implementation Phases

### Phase 1: Version Infrastructure

1. Create `apps/periscope/src/version.ts` with:
   - `export const APP_VERSION = "1.26.03.26"` (the display version constant)
   - `export interface ChangelogEntry { ... }` type definition (see Data Model section)
   - `export const CHANGELOG: ChangelogEntry[]` array with the initial entry for this version
2. Update `apps/periscope/vite.config.ts`:
   - Import `APP_VERSION` from `./src/version` (relative path, not `@/` alias -- the alias is only active during the app build, not during config processing)
   - Add `define: { __APP_VERSION__: JSON.stringify(APP_VERSION) }` to the Vite config object
   - Note: `version.ts` must remain pure (no browser APIs, no app imports) since Vite processes the config with esbuild in a Node context
3. Add the `__APP_VERSION__` global declaration to `apps/periscope/src/vite-env.d.ts`:
   - Append `declare const __APP_VERSION__: string;` to the existing file (which already declares File System Access API types)
4. Verify the define works by checking the build output includes the version literal.

### Phase 2: Changelog Modal Component

1. Create `apps/periscope/src/components/ChangelogModal.tsx`:
   - Props: `open: boolean`, `onClose: () => void`, `entries?: ChangelogEntry[]` (optional -- defaults to full `CHANGELOG` from `@/version`), `title?: string` (optional -- defaults to `"Changelog"`, allows WhatsNew to pass `"What's New"`)
   - Import `CHANGELOG` and `ChangelogEntry` from `@/version`
   - Render a modal overlay using `fixed inset-0 z-50 bg-black/60` backdrop (same pattern as `AddCharacterDialog`)
   - Modal container: max-w-lg, max-h-[80vh], rounded-xl, bg-zinc-900, border border-zinc-700, shadow-2xl (matches AddCharacterDialog pattern)
   - Header: title "Changelog" with current version `v{__APP_VERSION__}`, close button (X icon)
   - Body: scrollable `overflow-y-auto`, renders each entry as a section
   - Each entry shows version + date header, then a list of changes
   - Category badges with distinct colors: green/`bg-green-900/30 text-green-400` for "added", blue/`bg-blue-900/30 text-blue-400` for "changed", amber/`bg-amber-900/30 text-amber-400` for "fixed", red/`bg-red-900/30 text-red-400` for "removed"
   - If entry has a `highlights` string, show it as a subtitle under the version header

### Phase 3: Version Display in UI

1. Update `apps/periscope/src/components/Sidebar.tsx`:
   - Add local `useState<boolean>` for `changelogOpen` (same local-state pattern as `AddCharacterDialog` in `CharacterSection`)
   - Add a version display in the footer section (above or below the collapse button)
   - Show `v{__APP_VERSION__}` as small muted text (`text-[10px] text-zinc-600`)
   - Make it clickable (`onClick -> setChangelogOpen(true)`) to open the changelog modal
   - When collapsed, hide the version text (consistent with other sidebar text)
   - Render `<ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />` at the end of the component
2. Update `apps/periscope/src/views/Settings.tsx`:
   - Add local `useState<boolean>` for `changelogOpen`
   - Add an "About" section at the bottom (before Danger Zone)
   - Show the version number and a "View Changelog" button (`onClick -> setChangelogOpen(true)`)
   - Render `<ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />` at the end of the component
3. `apps/periscope/src/components/PWAPrompt.tsx` -- no changes needed. The update prompt stays generic ("New version available") per Open Question 1, Option B. The "What's New" modal after reload communicates version details.

### Phase 4: "What's New" Auto-Prompt

1. Create `apps/periscope/src/hooks/useWhatsNew.ts`:
   - On mount, read `localStorage` key `periscope:lastSeenVersion`
   - Compare with `__APP_VERSION__` -- if different (or missing), set `show: true`
   - Compute `newEntries`: filter `CHANGELOG` to entries where `entry.version > lastSeenVersion` (lexicographic comparison works for `R.YY.MM.DD` format)
   - If `newEntries` is empty (e.g., version changed but no changelog entry exists yet), do not show the modal
   - Export `{ show, newEntries, dismiss }` -- `dismiss()` writes `__APP_VERSION__` to `localStorage` and sets `show: false`
2. Create `apps/periscope/src/components/WhatsNew.tsx`:
   - Uses the `useWhatsNew` hook to get `{ show, newEntries, dismiss }` state
   - Renders `ChangelogModal` with `title="What's New"` and `entries={newEntries}` to show only changelog entries newer than the user's last-seen version
   - `onClose` calls `dismiss()` which writes current version to `localStorage` and hides the modal
   - Rendered in `Layout.tsx` alongside `PWAPrompt`
3. Update `apps/periscope/src/components/Layout.tsx`:
   - Import and render `WhatsNew` component

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/periscope/src/version.ts` | CREATE | Version constant, ChangelogEntry type, CHANGELOG array |
| `apps/periscope/src/vite-env.d.ts` | MODIFY | Add `__APP_VERSION__` global declaration to existing file |
| `apps/periscope/vite.config.ts` | MODIFY | Add `define` block injecting `__APP_VERSION__` |
| `apps/periscope/src/components/ChangelogModal.tsx` | CREATE | Modal component displaying the changelog |
| `apps/periscope/src/components/Sidebar.tsx` | MODIFY | Add clickable version text in sidebar footer |
| `apps/periscope/src/views/Settings.tsx` | MODIFY | Add "About" section with version + changelog link |
| `apps/periscope/src/components/PWAPrompt.tsx` | NO CHANGE | Update prompt stays generic; "What's New" handles version communication |
| `apps/periscope/src/hooks/useWhatsNew.ts` | CREATE | Hook to detect first visit after version change |
| `apps/periscope/src/components/WhatsNew.tsx` | CREATE | Auto-showing "What's New" wrapper around ChangelogModal |
| `apps/periscope/src/components/Layout.tsx` | MODIFY | Render WhatsNew component |

## Resolved Questions

1. **Should the PWA update prompt show the new version number?**
   - **Resolved: Option B -- Don't show version in the update prompt.** The update prompt stays simple ("New update available"). The "What's New" modal after reload communicates version details, avoiding confusion between the old version (still running) and the new version (waiting to activate).

2. **Should the "What's New" modal filter to show only changes since the user's last-seen version, or always show the full latest entry?**
   - **Resolved: Option A -- Show all entries newer than last-seen version.** Users who skip multiple versions see everything they missed. The CHANGELOG array is expected to stay short (solo-dev tool), so length is not a concern. The full changelog modal remains available for browsing history.

## Deferred

- **Auto-version bumping via CI/CD** -- Not needed; versions are manually bumped. Could add a script later if the workflow demands it.
- **Version comparison for changelog filtering** -- The `R.YY.MM.DD` format sorts lexicographically, so simple string comparison (`>`) works for now. A proper semver-like parser is unnecessary.
- **Changelog RSS/Atom feed** -- Out of scope for an offline-first PWA.
- **Version number in the PWA manifest** -- The `version` field in the web manifest is not standard; browser tooling uses `package.json` version for PWA metadata if needed.
