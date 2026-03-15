#!/usr/bin/env bash
# Deploy all TehFrontier smart contracts to Sui testnet.
#
# Usage:
#   ./scripts/deploy-contracts.sh [--tenant stillness] [--contract gate_acl]
#
# Prerequisites:
#   - Sui CLI installed: suiup install sui@testnet
#   - Active address with testnet SUI: sui client faucet
#   - Connected to testnet: sui client switch --env testnet
#
# Output: scripts/deploy-results.json (consumed by apply-deploy-results.mjs)

set -euo pipefail
cd "$(dirname "$0")/.."

TENANT="${1:-stillness}"  # default tenant
SINGLE="${2:-}"           # optional: deploy only one contract
RESULTS_FILE="scripts/deploy-results.json"
GAS_BUDGET=500000000

# ── Contracts and their shared object types ─────────────────────────────────
# Format: name:shared_object_type (empty if no shared object)
CONTRACTS=(
  "turret_shoot_all:"
  "gate_acl:config::ExtensionConfig"
  "gate_tribe:config::ExtensionConfig"
  "turret_priority:"
  "gate_toll:gate_toll::TollConfig"
  "bounty_board:bounty_board::BountyBoard"
  "lease:lease::LeaseRegistry"
  "exchange:"
  "ssu_market:"
  "token_template:"
)

# ── Preflight checks ───────────────────────────────────────────────────────
if ! command -v sui &>/dev/null; then
  echo "ERROR: sui CLI not found. Install it with:"
  echo "  curl -fsSL https://sui.io/install.sh | bash"
  echo "  suiup install sui@testnet"
  exit 1
fi

echo "=== TehFrontier Contract Deployment ==="
echo "Tenant:  $TENANT"
echo "Network: $(sui client active-env 2>/dev/null || echo 'unknown')"
echo "Address: $(sui client active-address 2>/dev/null || echo 'unknown')"
echo ""

# Check balance
BALANCE=$(sui client gas --json 2>/dev/null | grep -o '"totalBalance":"[0-9]*"' | head -1 | grep -o '[0-9]*' || echo "0")
echo "Gas balance: $BALANCE MIST"
if [ "${BALANCE:-0}" -lt 100000000 ]; then
  echo "WARNING: Low gas balance. Run 'sui client faucet' first."
fi
echo ""

# Initialize results file
echo "{}" > "$RESULTS_FILE"

# ── Deploy loop ─────────────────────────────────────────────────────────────
deploy_contract() {
  local NAME="$1"
  local SHARED_TYPE="$2"
  local DIR="contracts/$NAME"

  if [ ! -d "$DIR" ]; then
    echo "SKIP: $DIR not found"
    return
  fi

  echo "━━━ Deploying: $NAME ━━━"

  # Build
  echo "  Building..."
  if ! sui move build --path "$DIR" 2>&1 | tail -3; then
    echo "  ERROR: Build failed for $NAME"
    return 1
  fi

  # Publish
  echo "  Publishing..."
  local OUTPUT
  OUTPUT=$(sui client publish --path "$DIR" --gas-budget "$GAS_BUDGET" --json 2>&1)

  if echo "$OUTPUT" | grep -q '"error"'; then
    echo "  ERROR: Publish failed for $NAME"
    echo "$OUTPUT" | head -20
    return 1
  fi

  # Extract package ID
  local PACKAGE_ID
  PACKAGE_ID=$(echo "$OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
changes = data.get('objectChanges', [])
for c in changes:
    if c.get('type') == 'published':
        print(c['packageId'])
        break
" 2>/dev/null || echo "")

  if [ -z "$PACKAGE_ID" ]; then
    echo "  ERROR: Could not extract package ID from output"
    echo "$OUTPUT" > "scripts/deploy-output-${NAME}.json"
    echo "  Raw output saved to scripts/deploy-output-${NAME}.json"
    return 1
  fi

  echo "  Package ID: $PACKAGE_ID"

  # Extract shared object ID if applicable
  local CONFIG_OBJECT_ID=""
  if [ -n "$SHARED_TYPE" ]; then
    CONFIG_OBJECT_ID=$(echo "$OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
changes = data.get('objectChanges', [])
for c in changes:
    if c.get('type') == 'created' and '${SHARED_TYPE}' in c.get('objectType', ''):
        print(c['objectId'])
        break
" 2>/dev/null || echo "")

    if [ -n "$CONFIG_OBJECT_ID" ]; then
      echo "  Config Object: $CONFIG_OBJECT_ID"
    else
      echo "  WARNING: Expected shared object ($SHARED_TYPE) not found in output"
      echo "$OUTPUT" > "scripts/deploy-output-${NAME}.json"
    fi
  fi

  # Update results JSON
  python3 -c "
import json
with open('$RESULTS_FILE', 'r') as f:
    results = json.load(f)
results['$NAME'] = {
    'packageId': '$PACKAGE_ID',
    'configObjectId': '$CONFIG_OBJECT_ID' if '$CONFIG_OBJECT_ID' else None,
    'tenant': '$TENANT',
}
with open('$RESULTS_FILE', 'w') as f:
    json.dump(results, f, indent=2)
"

  echo "  Done!"
  echo ""
}

for ENTRY in "${CONTRACTS[@]}"; do
  NAME="${ENTRY%%:*}"
  SHARED_TYPE="${ENTRY#*:}"

  # If a specific contract was requested, skip others
  if [ -n "$SINGLE" ] && [ "$NAME" != "$SINGLE" ]; then
    continue
  fi

  deploy_contract "$NAME" "$SHARED_TYPE" || true
done

echo "━━━ Deployment Complete ━━━"
echo "Results saved to: $RESULTS_FILE"
echo ""
echo "Next: run 'node scripts/apply-deploy-results.mjs' to update TypeScript configs."
