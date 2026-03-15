#!/usr/bin/env node
/**
 * Reads deploy-results.json and updates the TypeScript config files
 * with the published package IDs and config object IDs.
 *
 * Usage: node scripts/apply-deploy-results.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const RESULTS_PATH = resolve(__dirname, "deploy-results.json");
const CHAIN_SHARED_CONFIG = resolve(ROOT, "packages/chain-shared/src/config.ts");
const PERISCOPE_CONFIG = resolve(ROOT, "apps/periscope/src/chain/config.ts");

// ── Mapping from contract name → config key names ─────────────────────────

const CHAIN_SHARED_MAP = {
  turret_shoot_all: { key: "turretShootAll", hasConfig: false },
  turret_priority: { key: "turretPriority", hasConfig: false },
  gate_acl: { key: "gateAcl", hasConfig: true },
  gate_tribe: { key: "gateTribe", hasConfig: true },
  gate_toll: { key: "gateToll", hasConfig: true },
  exchange: { key: "exchange", hasConfig: false },
  ssu_market: { key: "ssuMarket", hasConfig: false },
  bounty_board: { key: "bountyBoard", configKey: "boardObjectId" },
  lease: { key: "lease", configKey: "registryObjectId" },
  token_template: { key: "tokenTemplate", hasConfig: false },
};

const PERISCOPE_TEMPLATE_MAP = {
  turret_shoot_all: "turret_shoot_all",
  gate_tribe: "gate_tribe",
  gate_acl: "gate_acl",
  turret_priority: "turret_priority",
  gate_toll: "gate_toll",
};

// ── Load results ──────────────────────────────────────────────────────────

let results;
try {
  results = JSON.parse(readFileSync(RESULTS_PATH, "utf-8"));
} catch {
  console.error("ERROR: Could not read deploy-results.json");
  console.error("Run deploy-contracts.sh first.");
  process.exit(1);
}

const entries = Object.entries(results);
if (entries.length === 0) {
  console.log("No deployment results found. Nothing to update.");
  process.exit(0);
}

const tenant = entries[0][1].tenant;
console.log(`Applying ${entries.length} deployment results for tenant: ${tenant}\n`);

// ── Update packages/chain-shared/src/config.ts ───────────────────────────

let chainSharedSrc = readFileSync(CHAIN_SHARED_CONFIG, "utf-8");

for (const [contractName, result] of entries) {
  const mapping = CHAIN_SHARED_MAP[contractName];
  if (!mapping) continue;

  const { packageId, configObjectId } = result;
  if (!packageId) continue;

  // Build the value object
  let value;
  if (mapping.hasConfig && configObjectId) {
    value = `{ packageId: "${packageId}", configObjectId: "${configObjectId}" }`;
  } else if (mapping.configKey && configObjectId) {
    value = `{ packageId: "${packageId}", ${mapping.configKey}: "${configObjectId}" }`;
  } else {
    value = `{ packageId: "${packageId}" }`;
  }

  // Check if key already exists for this tenant
  const keyPattern = new RegExp(`(${tenant}:\\s*\\{[^}]*?)(?=\\})`);
  const existingKeyPattern = new RegExp(`${mapping.key}\\??: [^,}]+`);

  if (chainSharedSrc.match(existingKeyPattern)) {
    // Replace existing entry
    chainSharedSrc = chainSharedSrc.replace(
      existingKeyPattern,
      `${mapping.key}: ${value}`,
    );
  } else {
    // Need to add to the tenant object — find the tenant block and insert
    const tenantBlockRe = new RegExp(`(${tenant}:\\s*\\{)([^}]*)(\\})`);
    const match = chainSharedSrc.match(tenantBlockRe);
    if (match) {
      const existing = match[2].trim();
      const separator = existing ? ",\n\t\t" : "\n\t\t";
      chainSharedSrc = chainSharedSrc.replace(
        tenantBlockRe,
        `${match[1]}${match[2]}${existing ? "," : ""}\n\t\t${mapping.key}: ${value},\n\t${match[3]}`,
      );
    }
  }

  console.log(`  chain-shared: ${tenant}.${mapping.key} = ${packageId.slice(0, 16)}...`);
}

writeFileSync(CHAIN_SHARED_CONFIG, chainSharedSrc);
console.log(`  Updated: ${CHAIN_SHARED_CONFIG}\n`);

// ── Update apps/periscope/src/chain/config.ts ─────────────────────────────

let periscopeSrc = readFileSync(PERISCOPE_CONFIG, "utf-8");

for (const [contractName, result] of entries) {
  const templateId = PERISCOPE_TEMPLATE_MAP[contractName];
  if (!templateId) continue;

  const { packageId, configObjectId } = result;
  if (!packageId) continue;

  // Find the template block and update packageIds
  // Strategy: find the template by id, then update its packageIds and configObjectIds

  // Update packageIds — find the block for this template
  const templateRe = new RegExp(
    `(id:\\s*"${templateId}"[\\s\\S]*?packageIds:\\s*\\{)([^}]*)(\\})`,
  );
  const templateMatch = periscopeSrc.match(templateRe);
  if (templateMatch) {
    const existingPkgIds = templateMatch[2];
    // Remove commented-out lines for this tenant and add real one
    let updatedPkgIds = existingPkgIds
      .split("\n")
      .filter((line) => !line.includes(`// ${tenant}:`) && !line.includes(`${tenant}:`))
      .join("\n");

    // Add the real entry
    const indent = "\t\t\t";
    if (updatedPkgIds.trim()) {
      updatedPkgIds += `\n${indent}${tenant}: "${packageId}",`;
    } else {
      updatedPkgIds = `\n${indent}${tenant}: "${packageId}",\n\t\t`;
    }

    periscopeSrc = periscopeSrc.replace(
      templateRe,
      `${templateMatch[1]}${updatedPkgIds}${templateMatch[3]}`,
    );
  }

  // Update configObjectIds if applicable
  if (configObjectId) {
    const configRe = new RegExp(
      `(id:\\s*"${templateId}"[\\s\\S]*?configObjectIds:\\s*\\{)([^}]*)(\\})`,
    );
    const configMatch = periscopeSrc.match(configRe);
    if (configMatch) {
      let updatedConfigIds = configMatch[2]
        .split("\n")
        .filter(
          (line) =>
            !line.includes(`// ${tenant}:`) &&
            !line.includes(`${tenant}:`),
        )
        .join("\n");

      const indent = "\t\t\t";
      if (updatedConfigIds.trim()) {
        updatedConfigIds += `\n${indent}${tenant}: "${configObjectId}",`;
      } else {
        updatedConfigIds = `\n${indent}${tenant}: "${configObjectId}",\n\t\t`;
      }

      periscopeSrc = periscopeSrc.replace(
        configRe,
        `${configMatch[1]}${updatedConfigIds}${configMatch[3]}`,
      );
    }
  }

  console.log(
    `  periscope: ${templateId}.packageIds.${tenant} = ${packageId.slice(0, 16)}...`,
  );
}

writeFileSync(PERISCOPE_CONFIG, periscopeSrc);
console.log(`  Updated: ${PERISCOPE_CONFIG}\n`);

console.log("Done! Config files updated with deployment results.");
console.log("Run 'pnpm exec tsc --noEmit' to verify types.");
