# EVE Frontier Game Reference

**Last Updated:** 2026-03-08
**Status:** Public Alpha | **Current:** Cycle 5 launching | **Next:** Cycle 6 (June 2026)

---

## Overview

EVE Frontier is a **space survival MMO** by CCP Games, set in the far future of the EVE universe. It is NOT EVE Online — it's a separate game focused on rebuilding civilization from scratch. The core design philosophy is "Digital Physics" — the universe operates by fixed rules, and every action consumes **Fuel**, making energy/resource management the central survival pressure.

- **Engine:** CCP's proprietary **Carbon engine** (CDP game engine)
- **Platform:** PC (Windows)
- **Universe:** 24,000+ solar systems
- **Economy:** Fully player-driven
- **Open Source:** CCP intends to fully open-source the game client and engine

---

## Cycle 5 — "Shroud of Fear" (March 2026)

**Patch:** 0.5.1
**Launch:** March 11, 2026
**Server:** "Stillness"
**Official Notes:** https://evefrontier.com/en/news/patch-notes-founder-access-0-5-1-shroud-of-fear

### Major Features

**Signature Resolution System:**
- "Gradient of certainty" — no longer binary see/don't-see
- Signal stability, distance, and environmental interference determine detection
- Losing contact causes information to degrade gradually
- Players can hide through obfuscation or repositioning

**Shell Industry:**
- **Nursery** — produces shells (20 Building Foam, 3.2 min build time). Creates Reaping, Aggressive, Rugged variants with specialized bonuses.
- **Nest** — shell storage (20 Building Foam, 48 min build time)
- **Crown System** — imprint memories into active shells, weavable every 30 minutes
- Character and Shell sheets completely redesigned

**Construction Sites:**
- No longer carry materials in ship inventory when building at owned Network Nodes
- Place Construction Site → deliver materials → auto-build
- All construction times reduced 20%
- Building Foam rebalanced: 1→10 units per production run, volume 470→47

**Turret Overhaul:**
- Smart Turret removed, replaced by 3 specialized variants:
  - **Mini Turret** — small targets
  - **Turret** — medium targets
  - **Heavy Turret** — large targets
- Each uses unique weapons unavailable to players
- Advantage shifted toward defenders
- Gate and turret building restrictions removed
- Minimum turret distance removed

**Orbital Zones:**
- Complete replacement of dungeon system with 15 permanent zone variations
- NPCs no longer drop loot — players find wrecks and containers instead
- Feral drones move between POIs and react to environmental conditions
- Resource distribution completely revamped

**Crude & Fuel:**
- Two new crude types + micro-rift variants in most systems
- Four new leap drive types for different ship classes
- Starting regions reduced to increase player interaction

**Ship Balance:**
- Light combat ships: tighter turning, faster acceleration, active defense slots
- Heavy variants: passive defenses, higher top speed
- New **Exclave frigate LAI**: 2100 HP, 440 max velocity, 2/2/2 slot configuration

**Camera:** New undock animation, chase camera (C key), soft-follow target tracking, improved telescope mode

**Other:**
- Multiple anchor points (5-20) added to all L-points for base expansion
- Assembly naming standardized (Hangar M→Shelter, Printer S→Mini Printer, etc.)
- XP gain rebalanced across core activities
- **Sui Blockchain Migration** — Move from Ethereum/Redstone L2 to Sui L1

### EVE Frontier x Sui Hackathon 2026

**Theme:** "A Toolkit for Civilization"
**Dates:** March 11 — March 31, 2026
**Prize Pool:** $80,000 USD total
**Registration:** https://deepsurge.xyz/evefrontier2026
**Eligibility:** Open globally, individuals and teams up to 5

**Timeline:**
| Phase | Dates |
|-------|-------|
| Hackathon | March 11–31, 2026 |
| Community Voting | April 1–15, 2026 |
| Judging | April 15–22, 2026 |
| Winners Announced | April 24, 2026 |

**Two Development Tracks:**
1. **In-World Mods (Smart Assemblies)** — Customizable player-built structures with rules, automation, interactive functionality. Persist in the shared universe.
2. **External Tools via Official API** — Maps, dashboards, fleet coordination, analytics, real-time data visualization.

**5 Competition Categories:**
1. **Utility** — Mods that change how players survive, coordinate, explore, or compete
2. **Technical Implementation** — Clean architecture, smart use of Frontier systems, scalability
3. **Creative** — Novel ideas, clever reinterpretations, bold system concepts
4. **Weirdest Idea** — Visually striking, surprising, or meme-worthy creations
5. **Live Frontier Integration** — Mods deployed and functioning in Stillness, interacting with the live world

**Prizes:**
| Place | Cash | Extras |
|-------|------|--------|
| **1st** | $15,000 | EVE FanFest passes/travel, Ascended Founder, Primal Tribe Pack, 60K EVE Points, $10K SUI tokens, 5 Basecamp tickets |
| **2nd** | $7,500 | Ascended Founder, Primal Tribe Pack, 30K EVE Points, $5K SUI tokens, 5 Basecamp tickets |
| **3rd** | $5,000 | Ascended Founder, Primal Tribe Pack, 20K EVE Points, $2.5K SUI tokens, 3 Basecamp tickets |
| **5 Category Champions** | $5,000 each | Ascended Founder, Primal Tribe Pack, 20K EVE Points, $1K SUI tokens, 2 Basecamp tickets |

**Note:** Projects can only win one category max. Community voting plays a meaningful role in selecting winners. Submissions can be deployed to the live Stillness server during judging. No prior EVE Frontier or Move experience required.

### Utopia Sandbox Server

Hackathon participants get access to **Utopia**, a dedicated sandbox development server for building and testing systems inside the game.

**Setup Steps:**

1. **Download the launcher:** https://evefrontier.com/en/download

2. **Add the Utopia test server:**
   - **Windows:** Right-click the desktop shortcut → Properties → Add to the end of the Target field:
     ```
     --frontier-test-servers=Utopia
     ```
   - **Mac:** Open Terminal and run:
     ```
     cd /Applications; open 'EVE Frontier.app/' --args --frontier-test-servers=Utopia
     ```

3. **Select the Utopia server:** In the launcher, use the server dropdown (bottom-right corner) and select Utopia.

4. **Register your account:** Click Register and fill in your details. Enter the verification code sent via email. Download the Utopia client.

**Access Provisioning:**
- After registration you must wait for CCP to grant access. Until then you'll see a "Founder Access Required" error.
- One account per participant. Additional accounts must be requested through Discord.

**Sandbox Slash Commands:**
- `/moveme` — Displays star systems for instant travel
- `/giveitem <itemid> <quantity>` — Spawn items by numeric ID
- `/giveitem "<item name>" <quantity>` — Spawn items by name

**Common Test Item IDs:**
| Item | ID |
|------|----|
| Carbon Weave | 84210 |
| Thermal Composites | 88561 |
| Printed Circuits | 84180 |
| Reinforced Alloys | 84182 |
| Feldspar Crystals | 77800 |
| Hydrated Sulfide Matrix | 77811 |
| Building Foam | 89089 |

Additional item IDs available via the World API `/v2/types/` endpoint.

**Caution:** Overloading cargo prevents warping. Excess items must be transferred to storage or jettisoned.

**Docs:** https://docs.evefrontier.com/troubleshooting/sandbox-access

**Support:** Discord `HACKATHON` section for setup help, development Q&A, and finding teammates.

### Hackathon Tutorials

Official tutorials (live as of March 11):
1. **Tutorial 1** — Set up your environment with development tools for hackathon — *(video removed by uploader)*
2. **Tutorial 2** — Build your first Custom Contract — https://www.youtube.com/watch?v=5zbcVbR4UWE
3. **Tutorial 3** — How to build a dApp — https://youtu.be/5OZWy8MdE8s

Transcripts saved in `docs/tutorial2_transcript.txt` and `docs/tutorial3_transcript.txt`.

### Kickoff Stream

Hackathon Kickoff Stream: **March 11, 18:00 UTC**

---

## Previous Cycles

| Cycle | Name | Date | Key Features |
|-------|------|------|--------------|
| **1** | Promised Lands | June 2025 | Public Alpha launch; mission system; Grace progression (EVE Points); initial exploration/combat |
| **2** | — | ~Aug 2025 | Expanded galaxy; gameplay improvements; early base building |
| **3** | Silent Tide | Oct 15, 2025 | Creative base building (vertical, flexible); continuous industry; Death Loop respawn; WASD controls prototype; 2 new ships |
| **4** | — | Dec 2025 | Overhauled ship controls; character identity/customization; clone creation; tribal base building; distinct ship roles |

**Seasonal Structure:** Each cycle ends in a "Reckoning" (world reset). Grace converts to permanent EVE Points. Cycle length: 3 months (from Cycle 4 onward).

---

## Core Gameplay

### Mining
- Ore extracted from asteroid belts throughout solar systems
- Raw ore must be **refined** at Refinery structures before use
- Equipment: Small Cutting Lasers, Mining Crystals (High Slots)

### Crafting / Manufacturing
- Pipeline: **Ore → Refinery → Minerals → Assembler → Modules/Ships**
- **Portable Printer** — Early-game tool for weapons, cutters, crystals, ship hulls
- **Assembler** — Structure that combines items into ship modules
- Industry runs continuously while structures are powered and supplied

### Base Building
- Bases built at **Lagrange points** in orbit around celestial bodies
- Structures: Refineries, Assemblers, Storage Units, Turrets, Smart Assemblies
- Cycle 3: Vertical placement, flexible positioning
- Cycle 4: Tribal/cooperative building with shared zones and team roles
- Cycle 5: Base attack and defense mechanics

### Trading & Economy
- Fully player-controlled economy
- NPC market system bootstraps initial pricing per star system
- Each system has unique rates/spreads → arbitrage opportunities
- Every crafted item has unique provenance history
- Long-term: Full community control over taxation and resource distribution

### Travel
- **Smart Gates** — Player-built, programmable jump gates forming the travel network
- In-system travel vs system-to-system travel (differentiated in Cycle 5)

---

## Combat System

### Ship Fitting Slots

| Slot Type | Function |
|-----------|----------|
| **High Slot** | Offensive weapons, mining equipment |
| **Mid Slot** | Armor systems, repair, navigation, shields |
| **Low Slot** | Armor, shields, cargo expansion |
| **Engine Slot** | Engine installation and upgrades |

### Weapons
- Small Autocannons (AC Gyrojet Ammo)
- Base Autocannon
- Small Cutting Lasers (dual-purpose: mining + combat)
- Physics-based projectiles (scrap/steel balls)

### Combat Features
- Manual turret control (Cycle 5+)
- Signature/heat-based detection (Cycle 5)
- Line-of-sight occlusion (hide behind celestial objects)
- PvP killmails recorded on-chain

---

## Universe Design

- **24,000+ solar systems** in the Frontier star cluster
- Bases at **Lagrange points** (real orbital mechanics)
- Occlusion and line of sight matter tactically
- Player-built Smart Gate networks for inter-system travel
- Interactive 3D star map: [ef-map.com](https://ef-map.com/)

---

## Future Roadmap (Beyond Cycle 5)

| Cycle | Timing | Focus |
|-------|--------|-------|
| **6** | June 2026 | Details TBD; builds on Cycle 5 |
| **Long-term** | Ongoing | Full community economic control; open-source client/engine; modular ship construction; expanded tribal/faction systems |

**Roadmap Pillars:**
1. **Core Gameplay** — Manual turret control, active scanning, modular ship assembly, collision improvements
2. **Base Building** — Attack/defense, tribal construction, progression
3. **Character Identity** — Customization, clone system, persistent identity

---

## Community Resources

| Resource | Link |
|----------|------|
| Official Website | [evefrontier.com](https://evefrontier.com/en) |
| Discord | [discord.com/invite/evefrontier](https://discord.com/invite/evefrontier) (~54,700 members) |
| Fan Wiki | [evefrontier.wiki](https://evefrontier.wiki/) |
| Whitepaper | [whitepaper.evefrontier.com](https://whitepaper.evefrontier.com/) |
| Support/Guides | [support.evefrontier.com](https://support.evefrontier.com/hc/en-us/categories/17356348312220-Gameplay-Features) |
| Interactive Map | [ef-map.com](https://ef-map.com/) |
| Ship Database | [gamingwithdaopa.ellatha.com/evefrontier/ship-database](https://gamingwithdaopa.ellatha.com/evefrontier/ship-database/) |
| Linktree | [linktr.ee/evefrontier](https://linktr.ee/evefrontier) |
| Beginner's Guide | [poolpartynodes.com/eve-frontier-beginners-guide](https://poolpartynodes.com/eve-frontier-beginners-guide/) |
