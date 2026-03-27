# Plan: Branding Refresh -- README and Landing Page

**Status:** Ready
**Created:** 2026-03-27
**Module:** www (plus root README.md and CLAUDE.md)

## Overview

Frontier Periscope's current branding positions it as an "intel and monitoring tool" -- a framing that was accurate at launch when Sonar and log watching were the primary features. Since then, the app has grown into a comprehensive organizational platform for EVE Frontier: custom currencies and player-run markets, on-chain standings registries that control shared infrastructure access, encrypted private maps for secure coordination, and a treasury system for shared multi-user wallets. These economic and organizational features are the strongest differentiators, but both the README and the landing page undersell them.

This plan refreshes the messaging across both the root README.md and the marketing landing page (`apps/www/index.html`) to lead with the most compelling features -- custom currencies, standings-based diplomacy, encrypted maps, and treasury management -- while repositioning sonar/monitoring as one capability among many rather than the defining identity. The goal is to appeal to EVE Frontier players looking for organizational tools, not just intel watchers.

The landing page is a static HTML site served via Vite (`apps/www/`) with Tailwind CSS 4 -- no React, no JS framework. Changes are purely content and structure within `index.html`. The README is the root `README.md` that serves as the GitHub landing page.

## Current State

### README (C:/Projects/periscope/README.md)

- **Title line (L1):** "# Frontier Periscope"
- **Tagline (L3):** "Intel and monitoring tool for EVE Frontier -- built for the EVE Frontier hackathon. Vibe coded with Claude Code." -- the "intel and monitoring" framing sets the identity; the hackathon and vibe-coded attributions are secondary details that should be preserved or deliberately addressed
- **Getting started (L7-13):** Links to app.frontierperiscope.com, mentions EVE Vault for on-chain features, says "fully usable without it for read-only features like log analysis, star map, and standings management"
- **Features list (L19-29):** Lists 9 features in this order:
  1. Sonar -- leads the list
  2. Structures
  3. Star Map
  4. Extensions -- "Standings-based extension deployment for gates, turrets, and SSUs"
  5. Manifest
  6. Private Maps -- "Encrypted location sharing via X25519 sealed-box"
  7. Standings -- "Contact and tribe standings management with on-chain registry subscriptions"
  8. Market -- "Trading interface for in-game markets"
  9. Killmails
- **Privacy section (L31-33):** Emphasizes client-side, no backend, no tracking
- **Development section (L35-82):** Standard monorepo dev setup, package table, prerequisites, build commands, Cloudflare deployment

**Issues with current README:**
- "Intel and monitoring tool" tagline undersells the organizational/economic features
- Sonar leads the feature list despite currencies/standings/maps being more unique
- Market is described generically as "Trading interface" -- no mention of custom currencies or token factory
- Extensions are listed as a separate feature rather than integrated into standings
- Treasury exists in the app (route `/treasury`, view `Treasury.tsx`, sidebar link) but is not mentioned in the README
- Feature descriptions are terse and technical, not benefit-oriented

### Landing Page (C:/Projects/periscope/apps/www/index.html)

- **Meta description (L6):** "Intel and monitoring tool for EVE Frontier -- real-time sonar, structure management, star map, and more."
- **Hero section (L14-57):**
  - Logo + "Frontier Periscope" heading
  - Subtitle (L26-29): "Intel and monitoring tool for EVE Frontier. Real-time event tracking, structure management, and 3D star map -- all running locally in your browser."
  - CTAs: "Open Periscope" (primary) + "Install as Desktop App" (secondary)
- **Features grid (L60-106):** 6 feature cards in a 3-column grid:
  1. Sonar -- "Real-time on-chain and game log monitoring with configurable watchlists and ping alerts."
  2. Structures -- "Manage owned deployables with fuel tracking, extension deployment, and L-point resolution."
  3. Star Map -- "3D WebGL solar system visualization with jump route planning and system search."
  4. Private Maps -- "Encrypted location sharing via sealed-box cryptography with standings-based access control."
  5. Market -- "Create currencies, manage markets, and trade through the in-game governance market system."
  6. Killmails -- "Combat event tracking, threat assessment, and kill feed monitoring across the cluster."
- **Install section (L109-171):** 3-step PWA install instructions
- **Privacy section (L175-195):** "Fully Client-Side" with 0/0/100% stat cards
- **Requirements section (L199-210):** Chrome/Edge + EVE Vault
- **Footer (L213-232):** Logo, App/GitHub/EVE Frontier links

**Issues with current landing page:**
- Hero subtitle repeats the "intel and monitoring" framing
- Standings is completely absent from the feature cards -- one of the most unique features
- Market card mentions currencies but doesn't explain what that means (token economy)
- Private Maps card leads with technical implementation ("sealed-box cryptography") rather than benefit
- Treasury is implemented but not represented on the landing page
- Feature order leads with Sonar rather than the organizational/economic differentiators
- No dedicated section explaining the organizational toolkit value proposition
- Missing: Standings, Wallet, Dashboard, Jump Planner, Blueprints from the feature cards

### Sidebar Navigation (C:/Projects/periscope/apps/periscope/src/components/Sidebar.tsx L45-80)

The sidebar reveals the full feature set organized into four groups:
- **Intel:** Sonar, Killmails, Standings, Private Maps, Manifest
- **Navigation:** Star Map, Jump Planner
- **Assets:** Structures, Inventory, Wallet, Markets, Treasury
- **System:** Blueprints, Workers, Settings

Plus a Dashboard link at the top (from Plan 07, already implemented).

### Implementation Status of Related Plans

- **Treasury** (Plan 08) -- shared multi-user wallet, coin creation migration from Market, gate toll custom currency. **Implemented.** `Treasury.tsx` view exists, route `/treasury` is wired in `router.tsx` (L246-249), sidebar has Treasury link (L71), and `treasury-queries.ts` provides data layer.
- **Dashboard** (Plan 07) -- landing page with module cards. **Implemented.** `Dashboard.tsx` exists, route is wired in `router.tsx` (L108), sidebar has Dashboard link.
- **Manifest expansion** (Plan 04) -- cached markets, registries, private map index. **Partially implemented.** `manifestMarkets` and `manifestRegistries` tables exist in `db/index.ts` (L93-94, L560-561), `discoverMarkets()` and `discoverRegistries()` exist in `manifest.ts` (L1565, L1612), and `Standings.tsx` reads from `manifestRegistries` (L383, L633). Private map index table (`manifestPrivateMapIndex`) not yet confirmed.

### App Feature Inventory (from views directory)

Views that exist as source files in `apps/periscope/src/views/`:
Assets, Blueprints, Dashboard, Deployables, JumpPlanner, Killmails, Manifest, Market, PrivateMaps, Settings, Setup, Sonar, StarMap, Standings, Treasury, Wallet, Workers

## Target State

### README -- New Structure and Messaging

**New tagline:** "Peer into the frontier -- organizational toolkit for EVE Frontier"

This tagline captures both angles: "Peer into the frontier" evokes the blockchain visibility/intel functionality (echoing the periscope metaphor and the "peer into the blockchain" vibe), while "organizational toolkit" establishes the breadth of economic and management features. The double meaning of "frontier" connects the app name to the game.

**New structure:**

1. **Title + Tagline** -- one-liner that captures the breadth
2. **One-paragraph pitch** -- 3-4 sentences covering the key value props: custom currencies, standings-based infrastructure access, encrypted coordination, shared treasury, plus monitoring and navigation
3. **Getting Started** -- same as current (app link, EVE Vault mention, browser requirements)
4. **Feature Highlights** -- reordered and rewritten feature list:
   - **Custom Currencies & Markets** (was "Market") -- "Create your own token economy. Publish custom currencies, manage markets, and trade on player-run exchanges. Power your organization with its own medium of exchange."
   - **Standings & Diplomacy** (was "Standings" + "Extensions") -- "Manage shared infrastructure access between cooperating groups. On-chain standings registries control who can use your gates, turrets, and storage units. Define friend-or-foe rules and subscribe to allied registries."
   - **Private Maps** -- "Encrypted location sharing for secure coordination. Share structure locations only with trusted allies using X25519 sealed-box cryptography. Standings-based access modes let you control visibility through your registries."
   - **Treasury** -- "Shared multi-user wallet for organizations. Pool resources, collect gate toll revenue in custom currencies, and manage group finances with admin-controlled access."
   - **Sonar** -- "Real-time event monitoring across on-chain data and local game logs. Configurable watchlists with per-target ping alerts track activity in your territory."
   - **Structures** -- "Manage owned deployables and assemblies with fuel tracking, extension deployment, and location resolution from both public reveals and private maps."
   - **Star Map & Navigation** -- "3D WebGL solar system visualization with jump route planning. Search systems, plot routes, and explore the cluster."
   - **Killmails** -- "Combat event tracking and threat assessment across the cluster."
5. **Philosophy** -- why this project exists, 100% vibe coded, encouraging non-developers, why open source (new section -- see Phase 1 step 3)
6. **Privacy** -- same as current
7. **Development** -- same as current (package table, setup, build, deploy)
8. **License** -- same

### Landing Page -- New Structure and Messaging

**Meta description (L6):** Update to reflect the new framing. New: "Organizational toolkit for EVE Frontier -- custom currencies, standings-based diplomacy, encrypted maps, and real-time monitoring."

**Hero section:** Replace the subtitle with benefit-oriented copy that leads with the organizational angle.
- New subtitle: "Peer into the frontier. Custom currencies, on-chain diplomacy, encrypted coordination, shared treasury, and real-time intel -- all running locally in your browser."
- CTAs remain the same

**Features section:** Restructure from 6 cards to 8 cards in a 4-column grid (`lg:grid-cols-4`, 2 rows of 4) covering:
1. **Custom Currencies** -- "Build your own economy. Publish tokens, manage markets, and trade on player-run exchanges." (icon: Coins)
2. **Standings & Diplomacy** -- "Diplomacy on-chain. Standings registries control who can use your gates, turrets, and storage. Define alliances and manage access." (icon: Shield or BookUser)
3. **Private Maps** -- "Coordinate securely. Encrypted location sharing -- only trusted allies see your structure positions." (icon: Lock)
4. **Treasury** -- "Shared resources. Multi-user wallets for organizations. Collect toll revenue, pool funds, manage group finances." (icon: Wallet or Landmark)
5. **Sonar** -- "Real-time intel. On-chain and game log monitoring with watchlists and ping alerts." (icon: Radio/signal)
6. **Structures** -- "Manage your fleet. Fuel tracking, extension deployment, and location resolution." (icon: Package/box)
7. **Star Map** -- "Navigate the frontier. 3D solar system visualization with jump route planning." (icon: MapPin)
8. **Killmails** -- "Know the threats. Combat event tracking and kill feed across the cluster." (icon: Skull/crosshair)

**Screenshot placeholder slots:** Each feature card gets an optional `<div>` placeholder for a screenshot or illustration, hidden by default (empty with a comment marker). This makes it trivial to drop in images later without restructuring the card HTML. The placeholder sits between the icon and the heading:
```html
<!-- Screenshot: add <img src="..." alt="..." class="mb-3 rounded" /> here -->
```

**Install, Privacy, Requirements, Footer:** Keep as-is.

### Tone and Voice

- Speak to EVE Frontier players, not developers
- Lead with benefits ("Build your own economy") not implementation ("governance market system")
- Use action verbs: "Create", "Control", "Coordinate", "Monitor"
- Keep technical details (X25519, Sui, IndexedDB) in secondary descriptions, not headlines
- Frame standings as "diplomacy" and "access control", not just "contact management"
- Frame private maps as "secure coordination", not just "encrypted locations"

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tagline | "Peer into the frontier -- organizational toolkit for EVE Frontier" | Captures both the blockchain intel/visibility angle ("peer into") and the organizational breadth ("toolkit"). The double meaning of "frontier" connects app name to game. Solo players see the intel value; org leaders see the management tools. |
| Feature order in README | Custom Currencies -> Standings -> Private Maps -> Treasury -> Sonar -> Structures -> Star Map -> Killmails | Leads with the most unique differentiators (economic/organizational), then monitoring, then navigation. Matches the user's stated priority order. |
| Feature order on landing page | Same priority order as README, with 8 feature cards | Consistency between README and landing page. 8 cards in a 2x4 grid. |
| Landing page hero copy | Benefit-oriented, leads with "Peer into the frontier" framing | The hero is the first thing visitors see. Leading with "intel tool" undersells the breadth. "Peer into the frontier" hooks with the intel vibe, then the feature list delivers the organizational scope. |
| Treasury treatment | Fully implemented feature, no "coming soon" indicators | Treasury is implemented: `Treasury.tsx` view, `/treasury` route, sidebar link, `treasury-queries.ts`. Describe it as a live feature alongside all others. |
| Standings + Extensions merge | Combine into one "Standings & Diplomacy" feature | Extensions (gate/turret/SSU standings config) are the practical application of standings. Merging them into one feature description is clearer than listing them separately. |
| Landing page layout | Keep static HTML + Tailwind (no React migration) | The landing page is simple static content. Adding React would be over-engineering. Tailwind classes handle responsive layout. |
| Meta description update | Update to match new framing | SEO and link previews should reflect the new positioning. |
| Feature card count | 8 cards (up from 6) | Adding Standings (previously missing) and Treasury. Removing nothing -- all current cards are updated. |
| Grid layout | 4 columns at `lg` breakpoint (`lg:grid-cols-4`) | Two clean rows of 4 look balanced. Card descriptions are short (1-2 sentences) and don't need the width of 3-column cards. Falls back to 2 columns on `sm`, 1 on mobile. |
| Private Maps description | Lead with "Coordinate securely" not "sealed-box cryptography" | Players care about what it does for them, not the crypto primitive. Technical details can appear in the expanded description. |
| README "Extensions" feature | Fold into Standings description | Extensions are the mechanism by which standings control infrastructure access. Describing them separately confuses the value proposition. |
| README "Manifest" feature | Drop from feature list | Manifest is an internal data cache, not a user-facing feature. Players don't care about "local cache of on-chain entities" -- they care about what that cache enables (fast lookups, offline access). The privacy section already covers the local-storage angle. |
| Screenshot placeholders | Include HTML comment placeholders in each feature card now | Placeholder slots make it trivial to add images later without restructuring card HTML. Empty comments are invisible to users so they don't degrade the current experience. |
| Client-side section | Keep as-is, no new section on the landing page | The feature cards carry the value proposition through their copy. A separate "Why Periscope" section would be redundant. The "Fully Client-Side" section remains as a strong privacy differentiator. |
| Philosophy section in README | New section after features, before privacy | Covers 100% vibe-coded origin, encouragement for non-developers, and open source rationale. Authentic player voice, not corporate marketing. |

## Implementation Phases

### Phase 1: README Rewrite

1. **Update the title and tagline** at L1-3. Change from:
   ```
   # Frontier Periscope

   Intel and monitoring tool for EVE Frontier -- built for the EVE Frontier hackathon. Vibe coded with Claude Code.
   ```
   to:
   ```
   # Frontier Periscope

   Peer into the frontier -- organizational toolkit for [EVE Frontier](https://evefrontier.com).
   ```
   The hackathon attribution and "vibe coded" detail move into the new Philosophy section (step 3 below).

2. **Replace the existing feature list** (L19-29) with the reordered, rewritten feature descriptions. Eight features with benefit-oriented headings and 1-2 sentence descriptions each:
   - Custom Currencies & Markets
   - Standings & Diplomacy
   - Private Maps
   - Treasury
   - Sonar
   - Structures
   - Star Map & Navigation
   - Killmails

3. **Add a Philosophy section** after the Features section and before Privacy. Title: "Why This Exists". Content should cover three points in an authentic, encouraging tone:

   - **100% vibe coded** -- This project was built entirely without a single line of manually written code. Every line was generated through AI-assisted development using Claude Code. Mention the hackathon origin here (moved from the old tagline).
   - **Encouraging non-developers** -- One core intention is to show EVE Frontier players who have no coding skills that they CAN build and develop on the Frontier blockchain system. You don't need to be a software developer to participate in building tools for the community.
   - **Why open source** -- The project is open source specifically to support this goal -- so players can learn from it, fork it, modify it, and build their own tools. The open source license is a deliberate choice to lower the barrier to entry.

   Tone: Authentic and encouraging, written from the perspective of a player who used AI tools to build something real. Not preachy, not corporate. First person is fine. Example opening: "This project started as a hackathon entry and grew into something I use every day. Here's the thing -- I didn't write a single line of code by hand."

4. **Update the Getting Started section** (L7-13) to adjust the parenthetical about read-only features. Current: "fully usable without it for read-only features like log analysis, star map, and standings management". New: broaden to mention more features that work without wallet (star map, standings, killmails, log analysis).

5. **Keep Privacy (L31-33), Development (L35-82), and License (L80-82) sections unchanged.** The Privacy section now follows the new Philosophy section.

6. **Verify all links still work** (app.frontierperiscope.com, GitHub, EVE Vault, EVE Frontier).

7. **Update the root `CLAUDE.md`** (L5) project overview line. Currently says "an intel and monitoring tool for EVE Frontier". Update to: "an organizational toolkit for EVE Frontier". Note: `CLAUDE.md` is in `.gitignore` -- must use `git add -f` when committing.

**Files:**
| File | Action |
|------|--------|
| `README.md` | Modify |
| `CLAUDE.md` | Modify (project overview line; requires `git add -f`) |

### Phase 2: Landing Page Content Refresh

1. **Update `<meta name="description">`** at `apps/www/index.html` L6 from the current intel-focused description to: "Organizational toolkit for EVE Frontier -- custom currencies, standings-based diplomacy, encrypted maps, and real-time monitoring."

2. **Update the hero subtitle** at L26-29. Replace the current "Intel and monitoring tool for EVE Frontier. Real-time event tracking, structure management, and 3D star map" with: "Peer into the frontier. Custom currencies, on-chain diplomacy, encrypted coordination, shared treasury, and real-time intel -- all running locally in your browser."

3. **Replace the 6-card feature grid** (L60-106) with an 8-card grid using `lg:grid-cols-4` for 2 rows of 4:
   - Change the grid classes from `lg:grid-cols-3` to `lg:grid-cols-4`
   - Increase the features section container from `max-w-5xl` to `max-w-6xl` to give 4-column cards adequate width (at `max-w-5xl` with 4 columns and `gap-6`, each card would be ~232px wide which feels cramped; `max-w-6xl` gives ~280px per card)
   - Reorder cards: Custom Currencies, Standings & Diplomacy, Private Maps, Treasury, Sonar, Structures, Star Map, Killmails
   - Rewrite each card's `<h3>` and `<p>` with benefit-oriented copy
   - Add inline SVG icons for new cards. The existing cards use inline SVGs sourced from the Lucide icon set (24x24 viewBox, stroke-based). New cards need matching SVGs:
     - Standings: use the `shield` or `book-user` Lucide icon SVG
     - Treasury: use the `landmark` Lucide icon SVG (matching the sidebar icon)
   - Add a screenshot placeholder comment inside each feature card, between the icon div and the `<h3>`:
     ```html
     <!-- Screenshot: add <img src="..." alt="..." class="mb-3 rounded" /> here -->
     ```
     This is invisible to users but marks the exact insertion point for future screenshots.

4. **Keep the Install section** (L109-171) unchanged.

5. **Keep the Privacy "Fully Client-Side" section** (L175-195) unchanged.

6. **Keep the Requirements section** (L199-210) and Footer (L213-232) unchanged.

7. **Optionally update the `<title>` tag** at L8 -- currently "Frontier Periscope". Could add a subtitle for SEO: "Frontier Periscope -- Organizational Toolkit for EVE Frontier". This is a minor enhancement.

**Files:**
| File | Action |
|------|--------|
| `apps/www/index.html` | Modify |

## File Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `README.md` | Modify | 1 | Rewrite tagline, feature list, add philosophy section, and one-paragraph pitch. Lead with currencies/standings/maps/treasury. |
| `CLAUDE.md` | Modify | 1 | Update project overview line (L5) to match new framing. In `.gitignore`, requires `git add -f`. |
| `apps/www/index.html` | Modify | 2 | Update meta description, hero subtitle, feature cards (8 cards in 4-column grid, reordered, benefit-oriented copy, screenshot placeholders), optional title tag. |

## Resolved Questions

1. **Tagline** -- "Peer into the frontier -- organizational toolkit for EVE Frontier". Captures both angles: "Peer into the frontier" evokes blockchain visibility and the periscope metaphor for solo intel players, while "organizational toolkit" establishes the management breadth for org leaders.

2. **Treasury treatment** -- Treasury is fully implemented (`Treasury.tsx`, `/treasury` route, sidebar link, `treasury-queries.ts`). All "coming soon" language removed. Treasury is described as a live feature throughout.

3. **Grid layout** -- 4 columns at `lg` breakpoint (`lg:grid-cols-4`). Two clean rows of 4 cards. Container widened to `max-w-6xl` for adequate card width.

4. **Screenshots** -- Screenshot placeholder slots (HTML comments) added to each feature card in Phase 2. Invisible to users but mark the exact insertion point for future images. No separate plan needed for the placeholder structure.

5. **Client-side section** -- Keep as-is. No new "Why Periscope" section on the landing page. Feature cards carry the value proposition.

## Deferred

- **Actual screenshot images** -- requires capturing images from the running app, annotating them, optimizing file sizes, and adding responsive image handling. The placeholder slots from Phase 2 make this easy to do later.
- **Video demo or animated GIFs** -- high-impact marketing content but high production effort. Separate initiative.
- **Blog post or changelog announcement** -- announcing the feature expansion to existing users. Different channel, different format.
- **SEO optimization beyond meta tags** -- structured data, Open Graph tags, Twitter cards. Worth doing but orthogonal to the messaging refresh.
- **Landing page redesign** -- this plan changes content within the existing layout. A full visual redesign (new sections, animations, interactive demos) is a larger effort.
