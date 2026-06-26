# Standard Labor Valuation System

A Labor Theory of Value framework for EVE Frontier (Cycle 5) resources and items. Every item's "cost of production" is expressed as a vector of Standard Labor Hours -- one dimension per facility type.

## Standard Labor Units

Each unit represents **1 hour of continuous operation** on the baseline (smallest) equipment for that facility category.

| Category | Acronym | Baseline Equipment | Cycle Time | Runs/Hour |
|----------|---------|-------------------|------------|-----------|
| Mining | SMH | Small Cutting Laser (77852) | ~4s | ~900 cycles |
| Refining | SRH | Field Refinery (87161) | 3s | 1,200 |
| Printing | SPH | Field Printer (87162) | 3--5s | 720--1,200 |
| Assembly | SAH | Assembler (88068) | varies | varies |
| Berthing | SBH | Mini Berth (88069) | TBD | TBD |
| Nursery | SNH | Nursery (91978) | TBD | TBD |

### 1 SMH = 18,000 ore

Small Cutting Laser: 20 ore/cycle, ~4s cycle, 5 ore/sec theoretical. All ore types mine at equal rate.

Observed gameplay rates: ~205 ore/min (1 laser with overhead), ~417 ore/min (2 lasers). The 18,000 figure uses the theoretical 300 ore/min rate.

### 1 SRH = 1,200 runs of Field Refinery

Output per SRH depends on which ore you refine:

| Recipe (BP) | Input / hr | Output / hr |
|-------------|-----------|-------------|
| Feldspar (1182) | 24,000 Feldspar | 6,000 Hydrocarbon Residue + 18,000 Silica Grains |
| HSM (1183) | 24,000 HSM | 12,000 Hydrocarbon Residue + 180,000 Water Ice |
| PPM (1184) | 24,000 PPM | 9,600 Silica Grains + 18,000 Iron-Rich Nodules + 4,800 Palladium |

All T1 recipes consume 1.333 SMH of ore per SRH (24,000 ore/hr).

### 1 SPH = 720--1,200 runs of Field Printer

Run count varies by recipe. Output per SPH:

| Recipe (BP) | Runs/hr | Input / hr | Output / hr |
|-------------|---------|-----------|-------------|
| Thermal Composites (1000) | 900 | 126,000 HR + 81,000 SG | 12,600 TC |
| Printed Circuits (1002) | 1,200 | 3,600 HR + 6,000 SG | 1,200 PC |
| Carbon Weave (1003) | 720 | 252,000 HR | 10,080 CW |
| Reinforced Alloys (1004) | 900 | 94,500 SG + 63,000 IRN + 63,000 Pd | 7,200 RA |

## Item Tier Classification

| Tier | Description | Labor Dimensions |
|------|-------------|-----------------|
| 0 | Raw ores | SMH |
| 1 | Tier 1 refined materials | SMH + SRH |
| 2a | Tier 2 refined materials | SMH + SRH (two refining steps) |
| 2b | Printed components (from T1) | SMH + SRH + SPH |
| 2c | Printed components (from T2) | SMH + SRH + SRH + SPH |
| 3 | Assembled items | SMH + SRH + SPH + SAH |
| 4 | Ships | SMH + SRH + SPH + SAH + SBH |

---

## V1 Scope: Raw Ores -> Components -> Building Foam

### Raw Ores (Tier 0)

All ores mine at equal rate. 1 ore = 1/18,000 SMH = 0.2s of mining time.

| Ore | typeID | Labor per Unit |
|-----|--------|---------------|
| Feldspar Crystals | 77800 | 0.0000556 SMH |
| Hydrated Sulfide Matrix | 77811 | 0.0000556 SMH |
| Platinum-Palladium Matrix | 77810 | 0.0000556 SMH |

### Tier 1 Refining -- Field Refinery (87161), 3s/run

| BP | Input (per run) | Outputs (per run) | Ore Cost | Refine Cost |
|----|----------------|-------------------|----------|-------------|
| 1182 | 20 Feldspar | 5 Hydrocarbon Residue + 15 Silica Grains | 4s SMH | 3s SRH |
| 1183 | 20 HSM | 10 Hydrocarbon Residue + 150 Water Ice | 4s SMH | 3s SRH |
| 1184 | 20 PPM | 8 Silica Grains + 15 Iron-Rich Nodules + 4 Palladium | 4s SMH | 3s SRH |

**Key insight:** All T1 recipes consume 20 ore per run (4s SMH) and 3s SRH. The ore type determines the output mix. Joint production means you cannot produce Iron-Rich Nodules or Palladium without also producing Silica Grains.

### Tier 1 Material Sources

| Material | Source BPs | Yield per Run | Exclusive Source? |
|----------|-----------|---------------|-------------------|
| Hydrocarbon Residue | 1182 (5), 1183 (10) | 5--10 | No (two sources) |
| Silica Grains | 1182 (15), 1184 (8) | 8--15 | No (two sources) |
| Iron-Rich Nodules | 1184 only | 15 | Yes (PPM ore only) |
| Palladium | 1184 only | 4 | Yes (PPM ore only) |
| Water Ice | 1183 only | 150 | Yes (HSM ore only) |

### Tier 2 Refining -- Refinery (88063), 9s/run

| BP | Input (per run) | Outputs (per run) |
|----|----------------|-------------------|
| 1186 | 20 Hydrocarbon Residue | 20 Troilite Sulfide Grains + 180 Tholin Aggregates |
| 1190 | 20 Silica Grains | 50 Feldspar Crystal Shards + 150 Silicon Dust |
| 1192 | 10 Iron-Rich Nodules | 20 Platinum-Group Veins + 198 Nickel-Iron Veins |

---

## Component Production (Two Routes)

### Route A: Field Refinery -> Field Printer

Uses T1 materials directly. Requires Palladium for Reinforced Alloys.

| BP | Component | Inputs | Output | Run Time | Facility |
|----|-----------|--------|--------|----------|----------|
| 1000 | Thermal Composites | 140 HR + 90 SG | 14 | 4s | Field Printer |
| 1002 | Printed Circuits | 3 HR + 5 SG | 1 | 3s | Field Printer |
| 1003 | Carbon Weave | 350 HR | 14 | 5s | Field Printer |
| 1004 | Reinforced Alloys | 105 SG + 70 IRN + 70 Pd | 8 | 4s | Field Printer |

### Route B: Field Refinery -> Refinery -> Mini Printer

Uses T2 materials. No Palladium needed. Better Reinforced Alloys yield (14 vs 8).

| BP | Component | Inputs | Output | Run Time | Facility |
|----|-----------|--------|--------|----------|----------|
| 1021 | Thermal Composites | 630 SiDust + 1,260 Tholin + 210 FCS | 14 | 4s | Mini Printer |
| 1017 | Printed Circuits | 37 SiDust + 22 Tholin | 1 | 3s | Mini Printer |
| 1020 | Carbon Weave | 3,150 Tholin | 14 | 5s | Mini Printer |
| 1019 | Reinforced Alloys | 1,050 NiFeV + 1,050 FCS | 14 | 4s | Mini Printer |

### Building Foam -- Mini Printer (87119)

| BP | Inputs | Output | Run Time |
|----|--------|--------|----------|
| 1015 | 65 Reinforced Alloys + 65 Carbon Weave + 65 Thermal Composites | 10 Building Foam | 25s |

---

## Building Foam Rollup -- Route A

Full production chain from raw ore to 10 Building Foam using Route A (Field-tier printing).

### Step 1: Component Printing (Field Printer 87162)

| Component | BP | Runs Needed | Inputs | Print Time |
|-----------|-----|------------|--------|------------|
| 65 Thermal Composites | 1000 | 65/14 = 4.643 | 650 HR + 417.9 SG | 18.6s |
| 65 Carbon Weave | 1003 | 65/14 = 4.643 | 1,625 HR | 23.2s |
| 65 Reinforced Alloys | 1004 | 65/8 = 8.125 | 853.1 SG + 568.8 IRN + 568.8 Pd | 32.5s |
| **Subtotal** | | | | **74.3s SPH** |

Plus 25.0s for Building Foam printing (Mini Printer). **Total SPH: 99.3s**

### Step 2: Total T1 Materials Required

| Material | From TC | From CW | From RA | Total |
|----------|---------|---------|---------|-------|
| Hydrocarbon Residue | 650 | 1,625 | -- | 2,275 |
| Silica Grains | 417.9 | -- | 853.1 | 1,271.0 |
| Iron-Rich Nodules | -- | -- | 568.8 | 568.8 |
| Palladium | -- | -- | 568.8 | 568.8 |

### Step 3: Optimal T1 Refining (Field Refinery 87161)

Palladium is the binding constraint from BP 1184. Minimize total ore by using BP 1182 for Silica Grains first, BP 1183 for remaining Hydrocarbon Residue.

| BP | Runs | Ore Consumed | Produces |
|----|------|-------------|----------|
| 1184 (PPM) | 142.2 | 2,843.8 PPM | 1,137.5 SG + 2,132.8 IRN + 568.8 Pd |
| 1182 (Feldspar) | 8.9 | 177.9 Feldspar | 44.5 HR + 133.5 SG |
| 1183 (HSM) | 223.1 | 4,461.0 HSM | 2,230.5 HR + 33,457.5 WI |
| **Total** | **374.1** | **7,482.7 ore** | |

**Refining time: 374.1 runs x 3s = 1,122.4s SRH**

### Step 4: Waste Analysis

| Material | Produced | Consumed | Excess |
|----------|----------|----------|--------|
| Silica Grains | 1,271.0 | 1,271.0 | 0 |
| Hydrocarbon Residue | 2,275.0 | 2,275.0 | 0 |
| Iron-Rich Nodules | 2,132.8 | 568.8 | **1,564.1** |
| Palladium | 568.8 | 568.8 | 0 |
| Water Ice | 33,457.5 | 0 | **33,457.5** |

### Route A Summary (10 Building Foam)

| Labor Type | Quantity | Time (seconds) | Standard Hours |
|------------|----------|---------------|----------------|
| Mining | 7,482.7 ore | 1,496.5s | **0.4157 SMH** |
| T1 Refining | 374.1 runs | 1,122.4s | **0.3118 SRH** |
| Printing | 17.4 runs | 99.3s | **0.0276 SPH** |
| **Total** | | **2,718.2s** | **0.7551 total hrs** |

**Per Building Foam (Route A): 0.0416 SMH + 0.0312 SRH + 0.0028 SPH = 271.8s (4m 32s)**

---

## Building Foam Rollup -- Route B

Full production chain using Route B (Tier 2 refining + Mini Printer for everything).

### Step 1: Component Printing (Mini Printer 87119)

| Component | BP | Runs Needed | Inputs | Print Time |
|-----------|-----|------------|--------|------------|
| 65 Thermal Composites | 1021 | 65/14 = 4.643 | 2,925 SiDust + 5,850 Tholin + 975 FCS | 18.6s |
| 65 Carbon Weave | 1020 | 65/14 = 4.643 | 14,625 Tholin | 23.2s |
| 65 Reinforced Alloys | 1019 | 65/14 = 4.643 | 4,875 NiFeV + 4,875 FCS | 18.6s |
| Building Foam | 1015 | 1 | 65 RA + 65 CW + 65 TC | 25.0s |
| **Total** | | | | **85.4s SPH** |

### Step 2: Total T2 Materials Required

| Material | From TC | From CW | From RA | Total |
|----------|---------|---------|---------|-------|
| Silicon Dust | 2,925 | -- | -- | 2,925 |
| Tholin Aggregates | 5,850 | 14,625 | -- | 20,475 |
| Feldspar Crystal Shards | 975 | -- | 4,875 | 5,850 |
| Nickel-Iron Veins | -- | -- | 4,875 | 4,875 |

### Step 3: T2 Refining (Refinery 88063, 9s/run)

| BP | Runs | T1 Input | Produces |
|----|------|----------|----------|
| 1186 | 113.75 | 2,275 HR | 2,275 TSG + 20,475 Tholin |
| 1190 | 117.0 | 2,340 SG | 5,850 FCS + 17,550 SiDust |
| 1192 | 24.62 | 246.2 IRN | 492.4 PGV + 4,875 NiFeV |
| **Total** | **255.4** | | **T2 refine: 2,298.3s SRH** |

### Step 4: T1 Materials Required (for T2 refining)

| Material | Needed | Source |
|----------|--------|--------|
| Hydrocarbon Residue | 2,275 | BP 1182, 1183 |
| Silica Grains | 2,340 | BP 1182, 1184 |
| Iron-Rich Nodules | 246.2 | BP 1184 only |

### Step 5: Optimal T1 Refining (Field Refinery 87161)

| BP | Runs | Ore Consumed | Produces |
|----|------|-------------|----------|
| 1184 (PPM) | 16.4 | 328.3 PPM | 131.3 SG + 246.2 IRN + 65.7 Pd |
| 1182 (Feldspar) | 147.2 | 2,944.9 Feldspar | 736.2 HR + 2,208.7 SG |
| 1183 (HSM) | 153.9 | 3,077.5 HSM | 1,538.8 HR + 23,081.4 WI |
| **Total** | **317.5** | **6,350.7 ore** | **T1 refine: 952.6s SRH** |

### Step 6: Waste Analysis

| Material | Produced | Consumed | Excess |
|----------|----------|----------|--------|
| Silicon Dust | 17,550 | 2,925 | **14,625** |
| Troilite Sulfide Grains | 2,275 | 0 | **2,275** |
| Platinum-Group Veins | 492.4 | 0 | **492.4** |
| Palladium | 65.7 | 0 | **65.7** |
| Water Ice | 23,081.4 | 0 | **23,081.4** |

### Route B Summary (10 Building Foam)

| Labor Type | Quantity | Time (seconds) | Standard Hours |
|------------|----------|---------------|----------------|
| Mining | 6,350.7 ore | 1,270.1s | **0.3528 SMH** |
| T1 Refining | 317.5 runs | 952.6s | **0.2646 SRH** |
| T2 Refining | 255.4 runs | 2,298.3s | **0.6384 SRH** |
| Printing | 14.9 runs | 85.4s | **0.0237 SPH** |
| **Total** | | **4,606.5s** | **1.2796 total hrs** |

**Per Building Foam (Route B): 0.0353 SMH + 0.0903 SRH + 0.0024 SPH = 460.6s (7m 41s)**

---

## Route Comparison

| Metric | Route A | Route B | Delta |
|--------|---------|---------|-------|
| Total ore mined | 7,483 | 6,351 | B uses 15% less ore |
| Mining time (SMH) | 0.416 | 0.353 | B saves 15% mining |
| Total refining time (SRH) | 0.312 | 0.903 | B uses 190% more refining |
| Printing time (SPH) | 0.028 | 0.024 | B saves 14% printing |
| **Total labor time** | **0.755 hrs** | **1.280 hrs** | **B is 69% slower** |
| Palladium required | 568.8 | 0 | B avoids Pd dependency |
| Waste material units | ~35,022 | ~40,540 | B has 16% more waste |
| Facilities needed | Field Ref + Field Printer + Mini Printer | Field Ref + Refinery + Mini Printer | Same count, different tier |

### When to Use Each Route

**Route A** is better when:
- Minimizing total labor time
- Palladium supply is not a bottleneck
- You have Field Printers deployed

**Route B** is better when:
- Ore supply is limited (uses 15% less)
- Palladium is scarce or needed elsewhere
- You only have a Refinery + Mini Printer (no Field Printer)
- Waste Silicon Dust / Troilite Sulfide Grains have downstream uses

---

## Per-Component Labor Costs

Labor to produce 1 unit of each component in isolation, using optimal ore allocation. All times in facility-seconds. Divide by 3,600 for standard hours.

### Route A Components (per unit)

| Component | Ore | T1 Runs | Mine (s) | Refine (s) | Print (s) | **Total (s)** | Bottleneck |
|-----------|-----|---------|----------|-----------|-----------|------------|------------|
| Thermal Composite | 24.3 | 1.21 | 4.86 | 3.64 | 0.29 | **8.79** | Mining (55%) |
| Printed Circuit | 9.3 | 0.47 | 1.87 | 1.40 | 3.00 | **6.27** | Printing (48%) |
| Carbon Weave | 50.0 | 2.50 | 10.00 | 7.50 | 0.36 | **17.86** | Mining (56%) |
| Reinforced Alloy | 43.8 | 2.19 | 8.75 | 6.56 | 0.50 | **15.81** | Mining (55%) |

**Refining detail per component:**
- TC: 0.43 runs BP1182 (Feldspar) + 0.79 runs BP1183 (HSM) -- tight fit, zero waste on HR/SG
- PC: 0.33 runs BP1182 + 0.13 runs BP1183 -- tiny inputs, printing dominates
- CW: 2.5 runs BP1183 -- pure HR demand, HSM only
- RA: 2.19 runs BP1184 -- Pd-gated; wastes 24.1 IRN + 4.4 SG per unit

### Route B Components (per unit)

| Component | Ore | T1 Runs | T2 Runs | Mine (s) | T1 (s) | T2 (s) | Print (s) | **Total (s)** | Bottleneck |
|-----------|-----|---------|---------|----------|--------|--------|-----------|------------|------------|
| Thermal Composite | 24.0 | 1.20 | 0.80 | 4.80 | 3.60 | 7.20 | 0.29 | **15.89** | T2 Refine (45%) |
| Printed Circuit | 8.2 | 0.41 | 0.37 | 1.64 | 1.23 | 3.32 | 3.00 | **9.18** | T2 + Print (69%) |
| Carbon Weave | 50.0 | 2.50 | 1.25 | 10.00 | 7.50 | 11.25 | 0.36 | **29.11** | T2 Refine (39%) |
| Reinforced Alloy | 42.4 | 2.12 | 1.88 | 8.47 | 6.35 | 16.91 | 0.29 | **32.02** | T2 Refine (53%) |

**Refining detail per component:**
- TC: T1 = 0.4 BP1182 + 0.8 BP1183; T2 = 0.5 BP1186 + 0.3 BP1190. SiDust exactly covered by FCS byproduct.
- PC: T1 = 0.33 BP1182 + 0.08 BP1183; T2 = 0.12 BP1186 + 0.25 BP1190. Wastes 12.3 FCS.
- CW: T1 = 2.5 BP1183; T2 = 1.25 BP1186. Pure Tholin chain. Wastes 25 TSG.
- RA: T1 = 0.25 BP1184 + 1.87 BP1182; T2 = 0.38 BP1192 + 1.5 BP1190. Wastes 225 SiDust + 7.6 PGV + 9.3 HR.

### Component Comparison

| Component | Route A (s) | Route B (s) | Cheaper Route |
|-----------|------------|------------|---------------|
| Thermal Composites | 8.8 | 15.9 | **A (1.8x faster)** |
| Printed Circuits | 6.3 | 9.2 | **A (1.5x faster)** |
| Carbon Weave | 17.9 | 29.1 | **A (1.6x faster)** |
| Reinforced Alloys | 15.8 | 32.0 | **A (2x faster)** |

Route A wins on all 4 components in isolation. Route B's advantage only appears at the Building Foam level when Palladium scarcity or ore conservation matters.

**Key insight:** Printed Circuits are the outlier -- printing is 48% of their total labor (Route A), while for every other component printing is <4%. Anything needing lots of PCs (ships, modules) is heavily SPH-constrained.

### Building Foam (per block, optimized chain)

Building Foam needs 6.5 of each component + 2.5s print time. The optimized chain cross-utilizes joint production co-products (e.g., SG from Pd refining offsets TC/RA needs), saving ~15% vs naive component-sum.

| | Route A | Route B |
|---|---|---|
| Ore mined | 748.3 | 635.1 |
| Mining | 149.7s (0.0416 SMH) | 127.0s (0.0353 SMH) |
| T1 Refining | 112.2s (0.0312 SRH) | 95.3s (0.0265 SRH) |
| T2 Refining | -- | 229.8s (0.0638 SRH) |
| Printing | 9.9s (0.0028 SPH) | 8.5s (0.0024 SPH) |
| **Total** | **271.8s (4m 32s)** | **460.6s (7m 41s)** |
| Palladium consumed | 56.9 | 0 |
| Excess IRN | 156.4 | 0 |
| Excess Water Ice | 3,345.8 | 2,308.1 |

---

## Equipment Multipliers

### Mining Lasers

| Laser | typeID | portionSize | Ore/Cycle | Multiplier vs Small | Notes |
|-------|--------|-------------|-----------|---------------------|-------|
| Small Cutting Laser | 77852 | 2000 | 20.0 | 1.00x | Baseline (confirmed 4s cycle) |
| Medium Cutting Laser | 77853 | 1334 | 13.3 | TBD | portionSize lower -- need cycle time |
| Large Cutting Laser | 77854 | 910 | 9.1 | TBD | portionSize lower -- need cycle time |

**Open question:** portionSize decreases for higher-tier lasers. If cycle time is the same (4s), these are strictly worse. More likely they have faster cycles or different range/AOE tradeoffs. Need gameplay data to confirm.

### Facility Multipliers

| Category | Baseline | Higher Tier | Shared BPs? | Speed Diff? |
|----------|----------|-------------|-------------|-------------|
| Refining | Field Refinery (87161) | Refinery (88063) | Yes (1180, 1181) | TBD |
| Printing | Field Printer (87162) | Mini Printer (87119) | Yes (1005, 1007, 1010, 1013) | TBD |
| Assembly | Assembler (88068) | TBD | TBD | TBD |

**Open question:** Do shared blueprints run at different speeds on different facility tiers? If runTime is fixed per blueprint (not per facility), then higher-tier facilities only unlock new recipes, not faster processing.

---

## Methodology Notes

### Joint Production Problem

Many recipes produce multiple outputs (co-products). This creates an allocation challenge when computing per-unit labor costs.

**Approach used:** For complete production chains (e.g., Building Foam), we solve the optimal ore mix via linear optimization -- minimize total ore while satisfying all material constraints. Excess co-products are reported as waste.

For per-component costs, we assume the cheapest single-item production path (co-products treated as free byproducts). This gives a lower bound on labor cost.

### Assumptions

1. **Theoretical mining rate** -- 5 ore/sec (no overhead). Real rates are 30--40% lower.
2. **No batching losses** -- Fractional runs are allowed in calculations. In practice, you run whole batches and may overproduce.
3. **No transport time** -- Time to move materials between facilities is excluded.
4. **No fuel costs** -- Facility fuel consumption (D1 Fuel) is not included in labor hours. This could be added as a separate dimension.

### Future Extensions

- **SAH/SBH/SNH baselines** -- Calculate once assembly/berth/nursery recipes are fully mapped
- **Fuel cost overlay** -- Add D1 Fuel consumption as a parallel cost dimension
- **Market price integration** -- Compare labor value to market prices for arbitrage detection
- **Equipment ROI** -- How many standard hours to "pay off" a higher-tier facility vs baseline
- **Multi-product optimization** -- Minimize waste when producing multiple final products simultaneously

---

## Data Sources

| File | Contents |
|------|----------|
| `apps/periscope/public/data/blueprints.json` | 221 blueprints: runTime, inputs, outputs |
| `apps/periscope/public/data/facilities.json` | Facility -> blueprint mappings, capacities |
| `apps/periscope/public/data/types.json` | Item attributes (portionSize, volume, etc.) |
| `apps/periscope/public/data/groups.json` | Item group classifications |
