#!/usr/bin/env bash
# Create a custom org currency token on Sui testnet.
#
# Usage: ./scripts/create-token.sh <SYMBOL> <NAME> [DESCRIPTION] [DECIMALS]
# Example: ./scripts/create-token.sh GOLD "Organization Gold" "Governance token" 9
#
# Prerequisites:
#   - Sui CLI installed: suiup install sui@testnet
#   - Active address with testnet SUI: sui client faucet
#   - Connected to testnet: sui client switch --env testnet
#
# Output: packageId, coinType, treasuryCapId — paste these into Periscope

set -euo pipefail
cd "$(dirname "$0")/.."

SYMBOL="${1:-}"
NAME="${2:-}"
DESCRIPTION="${3:-A faction token}"
DECIMALS="${4:-9}"

if [ -z "$SYMBOL" ] || [ -z "$NAME" ]; then
	echo "Usage: $0 <SYMBOL> <NAME> [DESCRIPTION] [DECIMALS]"
	echo "Example: $0 GOLD \"Organization Gold\" \"Governance token\" 9"
	exit 1
fi

# Derive names
SYMBOL_UPPER=$(echo "$SYMBOL" | tr '[:lower:]' '[:upper:]')
SYMBOL_LOWER=$(echo "$SYMBOL" | tr '[:upper:]' '[:lower:]')
PACKAGE_NAME="${SYMBOL_LOWER}_token"
MODULE_NAME="${SYMBOL_UPPER}_TOKEN"
SENDER=$(sui client active-address 2>/dev/null)
GAS_BUDGET=500000000

echo "=== Create Token: $SYMBOL_UPPER ==="
echo "Package:  $PACKAGE_NAME"
echo "Module:   $MODULE_NAME"
echo "Name:     $NAME"
echo "Decimals: $DECIMALS"
echo "Sender:   $SENDER"
echo ""

# Create temp directory
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$TMPDIR/sources"

# Write Move.toml
cat > "$TMPDIR/Move.toml" <<TOML
[package]
name = "$PACKAGE_NAME"
edition = "2024"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "testnet-v1.66.2" }

[addresses]
$PACKAGE_NAME = "0x0"
TOML

# Write Move source
cat > "$TMPDIR/sources/${MODULE_NAME}.move" <<MOVE
module ${PACKAGE_NAME}::${MODULE_NAME};
use sui::coin;

public struct ${MODULE_NAME} has drop {}

fun init(witness: ${MODULE_NAME}, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        ${DECIMALS},
        b"${SYMBOL_UPPER}",
        b"${NAME}",
        b"${DESCRIPTION}",
        option::none(),
        ctx,
    );
    transfer::public_transfer(treasury, ctx.sender());
    transfer::public_freeze_object(metadata);
}

public entry fun mint(
    treasury: &mut coin::TreasuryCap<${MODULE_NAME}>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let minted = coin::mint(treasury, amount, ctx);
    transfer::public_transfer(minted, recipient);
}

public entry fun burn(
    treasury: &mut coin::TreasuryCap<${MODULE_NAME}>,
    coin: coin::Coin<${MODULE_NAME}>,
) {
    coin::burn(treasury, coin);
}
MOVE

# Build
echo "Building..."
sui move build --path "$TMPDIR" 2>&1 | tail -3

# Publish
echo "Publishing..."
OUTPUT=$(sui client publish --path "$TMPDIR" --skip-dependency-verification --gas-budget "$GAS_BUDGET" --json 2>&1)

# Extract packageId
PACKAGE_ID=$(echo "$OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('objectChanges', []):
    if c.get('type') == 'published':
        print(c['packageId'])
        break
" 2>/dev/null || echo "")

if [ -z "$PACKAGE_ID" ]; then
	echo "ERROR: Could not extract packageId"
	echo "$OUTPUT" > "/tmp/create-token-output.json"
	echo "Raw output saved to /tmp/create-token-output.json"
	exit 1
fi

# Extract TreasuryCap ID
TREASURY_CAP_ID=$(echo "$OUTPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for c in data.get('objectChanges', []):
    otype = c.get('objectType', '')
    if 'TreasuryCap' in otype:
        print(c['objectId'])
        break
" 2>/dev/null || echo "")

COIN_TYPE="${PACKAGE_ID}::${MODULE_NAME}::${MODULE_NAME}"

echo ""
echo "════════════════════════════════════════════════"
echo "  Token Created Successfully!"
echo "════════════════════════════════════════════════"
echo ""
echo "  Package ID:      $PACKAGE_ID"
echo "  Coin Type:       $COIN_TYPE"
echo "  Treasury Cap ID: $TREASURY_CAP_ID"
echo "  Module Name:     $MODULE_NAME"
echo ""
echo "  Paste these values into Periscope → Finance → Import Token"
echo "════════════════════════════════════════════════"
