#!/usr/bin/env bash
# Upgrade a deployed TehFrontier smart contract on Sui testnet.
#
# Usage: ./scripts/upgrade-contract.sh <contract_name>
# Example: ./scripts/upgrade-contract.sh ssu_market
#
# Prerequisites:
#   - Sui CLI installed: suiup install sui@testnet
#   - Active address with testnet SUI and matching UpgradeCap
#   - Connected to testnet: sui client switch --env testnet
#   - Move.toml already configured for upgrade:
#     - [addresses] set to published address (not "0x0")
#     - published-at field set
#
# The UpgradeCap ID is read from contracts/<name>/Published.toml.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${1:-}" ]; then
	echo "Usage: $0 <contract_name>"
	echo "Example: $0 ssu_market"
	exit 1
fi

NAME="$1"
DIR="contracts/$NAME"
PUBLISHED="$DIR/Published.toml"
GAS_BUDGET=500000000

# ── Validate ──────────────────────────────────────────────────────────────────

if [ ! -d "$DIR" ]; then
	echo "ERROR: Directory $DIR not found"
	exit 1
fi

if [ ! -f "$PUBLISHED" ]; then
	echo "ERROR: $PUBLISHED not found. Has this contract been published?"
	exit 1
fi

# Extract UpgradeCap ID and current published address
UPGRADE_CAP=$(grep 'upgrade-capability' "$PUBLISHED" | cut -d'"' -f2)
PUBLISHED_AT=$(grep 'published-at' "$PUBLISHED" | head -1 | cut -d'"' -f2)
CURRENT_VERSION=$(grep '^version' "$PUBLISHED" | head -1 | tr -dc '0-9')

if [ -z "$UPGRADE_CAP" ]; then
	echo "ERROR: Could not extract upgrade-capability from $PUBLISHED"
	exit 1
fi

# Verify Move.toml is in upgrade mode (address != "0x0")
ADDR=$(grep "^${NAME} = " "$DIR/Move.toml" | cut -d'"' -f2)
if [ "$ADDR" = "0x0" ]; then
	echo "ERROR: Move.toml has $NAME = \"0x0\" (fresh publish mode)."
	echo "       Set it to \"$PUBLISHED_AT\" for upgrade mode."
	exit 1
fi

# ── Preflight ─────────────────────────────────────────────────────────────────

echo "=== TehFrontier Contract Upgrade ==="
echo "Contract:    $NAME"
echo "UpgradeCap:  $UPGRADE_CAP"
echo "Published:   $PUBLISHED_AT"
echo "Version:     $CURRENT_VERSION → $((CURRENT_VERSION + 1))"
echo "Network:     $(sui client active-env 2>/dev/null || echo 'unknown')"
echo "Address:     $(sui client active-address 2>/dev/null || echo 'unknown')"
echo ""

# ── Build ─────────────────────────────────────────────────────────────────────

echo "Building..."
if ! sui move build --path "$DIR" 2>&1 | tail -5; then
	echo "ERROR: Build failed for $NAME"
	exit 1
fi
echo ""

# ── Upgrade ───────────────────────────────────────────────────────────────────

echo "Upgrading..."
OUTPUT=$(sui client upgrade \
	--upgrade-capability "$UPGRADE_CAP" \
	--path "$DIR" \
	--gas-budget "$GAS_BUDGET" \
	--json 2>&1)

if echo "$OUTPUT" | grep -q '"error"'; then
	echo "ERROR: Upgrade failed"
	echo "$OUTPUT" | head -20
	echo "$OUTPUT" > "scripts/upgrade-output-${NAME}.json"
	echo "Full output saved to scripts/upgrade-output-${NAME}.json"
	exit 1
fi

# ── Extract new package ID ────────────────────────────────────────────────────

NEW_PKG=$(echo "$OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('objectChanges', []):
    if c.get('type') == 'published':
        print(c['packageId'])
        break
" 2>/dev/null || echo "")

if [ -z "$NEW_PKG" ]; then
	echo "WARNING: Could not extract new package ID from output"
	echo "$OUTPUT" > "scripts/upgrade-output-${NAME}.json"
	echo "Full output saved to scripts/upgrade-output-${NAME}.json"
	exit 1
fi

echo ""
echo "=== Upgrade Complete ==="
echo "New package ID: $NEW_PKG"
echo ""
echo "Next steps:"
echo "  1. Update packages/chain-shared/src/config.ts with new package ID"
echo "  2. Update apps/periscope/src/chain/config.ts if extension templates changed"
echo "  3. Commit Published.toml changes: git add $PUBLISHED && git commit"
echo "  4. Build and deploy Periscope"
