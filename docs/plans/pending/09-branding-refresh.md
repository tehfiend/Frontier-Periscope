# Plan: Branding Refresh -- README and Landing Page

**Status:** Draft
**Created:** 2026-03-27
**Module:** periscope, www

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
- No mention of treasury (Plan 08, not yet implemented but planned)
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
- No mention of treasury (planned in Plan 08)
- Feature order leads with Sonar rather than the organizational/economic differentiators
- No dedicated section explaining the organizational toolkit value proposition
- Missing: Standings, Wallet, Dashboard, Jump Planner, Blueprints from the feature cards

### Sidebar Navigation (C:/Projects/periscope/apps/periscope/src/components/Sidebar.tsx L45-80)

The sidebar reveals the full feature set organized into four groups:
- **Intel:** Sonar, Killmails, Standings, Private Maps, Manifest
- **Navigation:** Star Map, Jump Planner
- **Assets:** Structures, Inventory, Wallet, Markets
- **System:** Blueprints, Workers, Settings

Plus a Dashboard link at the top (from Plan 07, already implemented).

### Implementation Status of Related Plans

- **Treasury** (Plan 08) -- shared multi-user wallet, coin creation migration from Market, gate toll custom currency. **Not yet implemented.** Plan is in `active/` but no Treasury view or contract exists in the codebase.
- **Dashboard** (Plan 07) -- landing page with module cards. **Implemented.** `Dashboard.tsx` exists, route is wired in `router.tsx` (L108), sidebar has Dashboard link.
- **Manifest expansion** (Plan 04) -- cached markets, registries, private map index. **Partially implemented.** `manifestMarkets` and `manifestRegistries` tables exist in `db/index.ts` (L93-94, L560-561), `discoverMarkets()` and `discoverRegistries()` exist in `manifest.ts` (L1565, L1612), and `Standings.tsx` reads from `manifestRegistries` (L383, L633). Private map index table (`manifestPrivateMapIndex`) not yet confirmed.

### App Feature Inventory (from views directory)

Views that exist as source files in `apps/periscope/src/views/`:
Assets, Blueprints, Dashboard, Deployables, JumpPlanner, Killmails, Manifest, Market, PrivateMaps, Settings, Setup, Sonar, StarMap, Standings, Wallet, Workers

## Target State

### README -- New Structure and Messaging

**New tagline:** Replace "Intel and monitoring tool" with something that captures the organizational/economic scope. Proposed: "Organizational toolkit for EVE Frontier" or "Run your frontier organization" (see Open Questions).

**New structure:**

1. **Title + Tagline** -- one-liner that captures the breadth
2. **One-paragraph pitch** -- 3-4 sentences covering the key value props: custom currencies, standings-based infrastructure access, encrypted coordination, shared treasury, plus monitoring and navigation
3. **Getting Started** -- same as current (app link, EVE Vault mention, browser requirements)
4. **Feature Highlights** -- reordered and rewritten feature list:
   - **Custom Currencies & Markets** (was "Market") -- "Create your own token economy. Publish custom currencies, manage markets, and trade on player-run exchanges. Power your organization with its own medium of exchange."
   - **Standings & Diplomacy** (was "Standings" + "Extensions") -- "Manage shared infrastructure access between cooperating groups. On-chain standings registries control who can use your gates, turrets, and storage units. Define friend-or-foe rules and subscribe to allied registries."
   - **Private Maps** -- "Encrypted location sharing for secure coordination. Share structure locations only with trusted allies using X25519 sealed-box cryptography. Standings-based access modes let you control visibility through your registries."
   - **Treasury** -- "Shared multi-user wallet for organizations. Pool resources, collect gate toll revenue in custom currencies, and manage group finances with admin-controlled access." (Note: Treasury is planned in Plan 08 but not yet implemented. Mark as "Coming soon" or similar.)
   - **Sonar** -- "Real-time event monitoring across on-chain data and local game logs. Configurable watchlists with per-target ping alerts track activity in your territory."
   - **Structures** -- "Manage owned deployables and assemblies with fuel tracking, extension deployment, and location resolution from both public reveals and private maps."
   - **Star Map & Navigation** -- "3D WebGL solar system visualization with jump route planning. Search systems, plot routes, and explore the cluster."
   - **Killmails** -- "Combat event tracking and threat assessment across the cluster."
5. **Privacy** -- same as current
6. **Development** -- same as current (package table, setup, build, deploy)
7. **License** -- same

### Landing Page -- New Structure and Messaging

**Meta description (L7):** Update to reflect the new framing. Proposed: "Organizational toolkit for EVE Frontier -- custom currencies, standings-based diplomacy, encrypted maps, and real-time monitoring."

**Hero section:** Replace the subtitle with benefit-oriented copy that leads with the organizational angle.
- New subtitle: "Build your frontier organization. Custom currencies, on-chain diplomacy, encrypted coordination, and real-time intel -- all running locally in your browser."
- CTAs remain the same

**Features section:** Restructure from 6 cards to 8 cards (2 rows of 4, or 2 rows of 3 + a row of 2) covering:
1. **Custom Currencies** -- "Build your own economy. Publish tokens, manage markets, and trade on player-run exchanges." (icon: Coins)
2. **Standings & Diplomacy** -- "Diplomacy on-chain. Standings registries control who can use your gates, turrets, and storage. Define alliances and manage access." (icon: Shield or BookUser)
3. **Private Maps** -- "Coordinate securely. Encrypted location sharing -- only trusted allies see your structure positions." (icon: Lock)
4. **Treasury** -- "Shared resources. Multi-user wallets for organizations. Collect toll revenue, pool funds, manage group finances." (icon: Wallet) (Mark as "Coming soon")
5. **Sonar** -- "Real-time intel. On-chain and game log monitoring with watchlists and ping alerts." (icon: Radio/signal)
6. **Structures** -- "Manage your fleet. Fuel tracking, extension deployment, and location resolution." (icon: Package/box)
7. **Star Map** -- "Navigate the frontier. 3D solar system visualization with jump route planning." (icon: MapPin)
8. **Killmails** -- "Know the threats. Combat event tracking and kill feed across the cluster." (icon: Skull/crosshair)

**New "Why Periscope" or "How It Works" section:** Optional section between features and install that briefly explains the value proposition for organizational play -- you bring the people, Periscope gives you the tools to run an economy, manage access, coordinate secretly, and monitor your territory.

**Install, Privacy, Requirements, Footer:** Keep as-is with minor copy tweaks if needed.

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
| Feature order in README | Custom Currencies -> Standings -> Private Maps -> Treasury -> Sonar -> Structures -> Star Map -> Killmails | Leads with the most unique differentiators (economic/organizational), then monitoring, then navigation. Matches the user's stated priority order. |
| Feature order on landing page | Same priority order as README, with 8 feature cards | Consistency between README and landing page. 8 cards in a 2x4 or 3+3+2 grid. |
| Landing page hero copy | Benefit-oriented, leads with "organization" framing | The hero is the first thing visitors see. Leading with "intel tool" undersells the breadth. Leading with "organizational toolkit" sets the right expectation. |
| Treasury in feature list | Include with "Coming soon" indicator | Treasury is actively planned (Plan 08) and central to the value proposition. Including it signals direction. Clearly marking it as upcoming avoids overselling. |
| Standings + Extensions merge | Combine into one "Standings & Diplomacy" feature | Extensions (gate/turret/SSU standings config) are the practical application of standings. Merging them into one feature description is clearer than listing them separately. |
| Landing page layout | Keep static HTML + Tailwind (no React migration) | The landing page is simple static content. Adding React would be over-engineering. Tailwind classes handle responsive layout. |
| Meta description update | Update to match new framing | SEO and link previews should reflect the new positioning. |
| Feature card count | 8 cards (up from 6) | Adding Standings (previously missing) and Treasury. Removing nothing -- all current cards are updated. |
| Private Maps description | Lead with "Coordinate securely" not "sealed-box cryptography" | Players care about what it does for them, not the crypto primitive. Technical details can appear in the expanded description. |
| README "Extensions" feature | Fold into Standings description | Extensions are the mechanism by which standings control infrastructure access. Describing them separately confuses the value proposition. |

## Implementation Phases

### Phase 1: README Rewrite

1. Update the title and tagline at L1-3. Change from:
   ```
   # Frontier Periscope
   Intel and monitoring tool for EVE Frontier -- built for the EVE Frontier hackathon. Vibe coded with Claude Code.
   ```
   to the new tagline (see Open Questions for exact wording). Preserve the "built for the EVE Frontier hackathon" and "Vibe coded with Claude Code" attributions -- move them to the pitch paragraph or a separate line below the new tagline.

2. Replace the existing feature list (L19-29) with the reordered, rewritten feature descriptions. Eight features with benefit-oriented headings and 1-2 sentence descriptions each. Treasury entry marked with "(Coming soon -- Plan 08)" or similar.

3. Update the Getting Started section (L7-13) to adjust the parenthetical about read-only features. Current: "fully usable without it for read-only features like log analysis, star map, and standings management". New: broaden to mention more features that work without wallet.

4. Keep Privacy (L31-33), Development (L35-82), and License (L80-82) sections unchanged.

5. Verify all links still work (app.frontierperiscope.com, GitHub, EVE Vault, EVE Frontier).

**Files:**
| File | Action |
|------|--------|
| `README.md` | Modify |

### Phase 2: Landing Page Content Refresh

1. Update `<meta name="description">` at `apps/www/index.html` L6 from the current intel-focused description to the new organizational framing.

2. Update the hero subtitle at L26-29. Replace the current "Intel and monitoring tool for EVE Frontier. Real-time event tracking, structure management, and 3D star map" with the new benefit-oriented copy.

3. Replace the 6-card feature grid (L60-106) with an 8-card grid:
   - Reorder: Custom Currencies, Standings & Diplomacy, Private Maps, Treasury, Sonar, Structures, Star Map, Killmails
   - Rewrite each card's `<h3>` and `<p>` with benefit-oriented copy
   - Add appropriate SVG icons for new/changed cards (Standings needs a shield or book-user icon; Treasury needs a wallet icon)
   - Add a "Coming soon" badge to the Treasury card (small text label, muted color)
   - Adjust grid layout: `lg:grid-cols-4` for 2 rows of 4, or keep `lg:grid-cols-3` for a 3-3-2 pattern (see Open Questions)

4. Optionally add a brief "value proposition" section between the features grid and the install section -- 2-3 sentences about why organizational players need Periscope. This could replace or supplement the existing "Fully Client-Side" section, or sit alongside it.

5. Keep the Install section (L109-171) unchanged.

6. Keep the Privacy "Fully Client-Side" section (L175-195) unchanged.

7. Keep the Requirements section (L199-210) and Footer (L213-232) unchanged.

**Files:**
| File | Action |
|------|--------|
| `apps/www/index.html` | Modify |

### Phase 3: Meta and SEO Alignment

1. Update the `<title>` tag at `apps/www/index.html` L8 if needed -- currently "Frontier Periscope" which is fine. Could add a subtitle: "Frontier Periscope -- Organizational Toolkit for EVE Frontier" for SEO.

2. Update the root `CLAUDE.md` (L5) project overview line. Currently says "an intel and monitoring tool for EVE Frontier". This is internal documentation but should be consistent. Update to match the new framing. Note: `CLAUDE.md` is in `.gitignore` -- changes here are local-only and must be force-added with `git add -f` if committing.

3. The root `package.json` has no `description` field -- no update needed.

**Files:**
| File | Action |
|------|--------|
| `apps/www/index.html` | Modify (title tag, if changing) |
| `CLAUDE.md` | Modify (project overview line) |

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `README.md` | Modify | Rewrite tagline, feature list, and pitch paragraph. Lead with currencies/standings/maps/treasury. |
| `apps/www/index.html` | Modify | Update meta description, hero subtitle, feature cards (8 cards, reordered, benefit-oriented copy), optional value prop section. |
| `CLAUDE.md` | Modify | Update project overview line (L5) to match new framing. Note: in `.gitignore`, requires `git add -f`. |

## Open Questions

1. **What should the new tagline be?**
   - **Option A: "Organizational toolkit for EVE Frontier"** -- Pros: clearly signals breadth beyond intel, positions for the target audience (org leaders). Cons: "toolkit" is generic, might not convey the on-chain aspect.
   - **Option B: "Run your frontier organization"** -- Pros: action-oriented, speaks directly to the user, implies comprehensive capability. Cons: sounds like it only serves org leaders, might alienate solo players.
   - **Option C: "Command and control for EVE Frontier"** -- Pros: evocative of the EVE space theme, implies both monitoring and management. Cons: military tone might not fit the economic/diplomatic features.
   - **Recommendation:** Option A. "Organizational toolkit" is accurate and broad enough to cover currencies, standings, maps, treasury, and monitoring. It clearly differentiates from the old "intel and monitoring" framing without being exclusionary.

2. **Should Treasury appear in the feature list before implementation?**
   - **Option A: Include with "Coming soon" badge** -- Pros: signals product direction, the economic features (currencies + treasury) are more compelling together. Cons: could frustrate users who expect it to work.
   - **Option B: Omit until Plan 08 is implemented** -- Pros: no false advertising, every listed feature works today. Cons: the value proposition is weaker without the treasury piece tying currencies to organizational finance.
   - **Recommendation:** Option A. The treasury is planned and actively being designed (Plan 08 is in active/). A clearly-labeled "Coming soon" indicator sets expectations honestly while showing the product's direction. This is common practice for tools in active development.

3. **Landing page feature grid layout: 4 columns or 3 columns?**
   - **Option A: 4 columns (`lg:grid-cols-4`)** -- Pros: all 8 cards fit in 2 clean rows. Cons: cards are narrower, less room for description text; might feel cramped on smaller laptop screens.
   - **Option B: 3 columns (`lg:grid-cols-3`, matching current)** -- Pros: cards have more room for text, consistent with current layout. Cons: 8 cards make a 3-3-2 pattern which looks unbalanced on the last row.
   - **Option C: 2 columns on md, 4 on xl, 3 on lg** -- Pros: responsive breakpoints handle all screen sizes well. Cons: more complexity in the grid classes.
   - **Recommendation:** Option A. Four columns at `lg` breakpoint. The card descriptions are short (1-2 sentences) and don't need the width of 3-column cards. Two clean rows of 4 look balanced. On `sm` it falls back to 2 columns, on mobile to 1 column.

4. **Should we plan for screenshots or feature illustrations?**
   - **Option A: Add screenshot/illustration slots now** -- Pros: visual content dramatically improves landing pages; placeholder structure makes it easy to add later. Cons: no screenshots exist yet, empty placeholders look worse than no images.
   - **Option B: Defer screenshots to a separate plan** -- Pros: keeps this plan focused on copy/messaging; screenshots need to be captured from the actual app and may need annotation. Cons: text-only landing page is less engaging.
   - **Recommendation:** Option B. Screenshots require a running app, careful framing, and possibly annotation. This plan should focus on getting the messaging right. A follow-up plan can add visual content once the copy is settled.

5. **Should the "Fully Client-Side" section be moved or restructured?**
   - **Option A: Keep as-is, add a new "Why Periscope" section above it** -- Pros: preserves the privacy emphasis, adds organizational value proposition. Cons: two consecutive text-heavy sections might feel redundant.
   - **Option B: Merge privacy messaging into a broader "Why Periscope" section** -- Pros: single cohesive section covering both the organizational value and the privacy angle. Cons: dilutes the privacy message.
   - **Option C: Keep as-is, no new section** -- Pros: simpler, less content to write and maintain. Cons: misses the opportunity to articulate the organizational value proposition.
   - **Recommendation:** Option C. The feature cards themselves should carry the value proposition through their copy. A separate "Why Periscope" section risks being redundant. Keep the "Fully Client-Side" section as a strong privacy differentiator.

## Deferred

- **Screenshots and feature illustrations** -- requires capturing images from the running app, annotating them, optimizing file sizes, and adding responsive image handling. Separate plan.
- **Video demo or animated GIFs** -- high-impact marketing content but high production effort. Separate initiative.
- **Blog post or changelog announcement** -- announcing the feature expansion to existing users. Different channel, different format.
- **SEO optimization beyond meta tags** -- structured data, Open Graph tags, Twitter cards. Worth doing but orthogonal to the messaging refresh.
- **Landing page redesign** -- this plan changes content within the existing layout. A full visual redesign (new sections, animations, interactive demos) is a larger effort.
- **Treasury feature card update post-implementation** -- once Plan 08 is implemented, remove the "Coming soon" badge from the Treasury card. Track as part of Plan 08's completion checklist.
