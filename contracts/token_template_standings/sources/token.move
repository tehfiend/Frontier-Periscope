/// Template coin module for standings-based faction token creation.
///
/// This module is compiled once and its bytecodes are patched at runtime
/// to create custom tokens. The client replaces:
///   - Module name: TOKEN_TEMPLATE_STANDINGS -> USER_TOKEN_NAME
///   - OTW struct name: TOKEN_TEMPLATE_STANDINGS -> USER_TOKEN_NAME
///   - Metadata byte vectors: symbol, name, description
///   - DECIMALS: u8 constant (default 9)
///   - REGISTRY_ID_BYTES: 32-byte vector (default sentinel)
///   - MIN_MINT: u8 constant (default 251)
///   - MIN_TRADE: u8 constant (default 252)
///   - MIN_BUY: u8 constant (default 253)
///
/// After publishing, a Market<T> is created automatically with the
/// TreasuryCap locked inside and standings thresholds configured.
module token_template_standings::TOKEN_TEMPLATE_STANDINGS;

use sui::coin;
use market_standings::market_standings;

/// One-Time Witness for the token. Struct name gets patched.
public struct TOKEN_TEMPLATE_STANDINGS has drop {}

/// Decimals constant -- stored in the constant pool so the bytecode patcher can replace it.
const DECIMALS: u8 = 9;

/// Sentinel: 32-byte vector, all zeros except last byte = 0x01.
/// Patcher replaces with actual registry ID bytes.
const REGISTRY_ID_BYTES: vector<u8> = x"0000000000000000000000000000000000000000000000000000000000000001";

/// Sentinel values for standings thresholds (outside valid range 0-6).
/// Each is a distinct value so the bytecode patcher won't collide on U8 replacement.
const MIN_MINT: u8 = 251;
const MIN_TRADE: u8 = 252;
const MIN_BUY: u8 = 253;

/// Initialize the token currency. Creates TreasuryCap + CoinMetadata.
/// TreasuryCap is consumed by market_standings::create_market (locked inside Market<T>).
/// CoinMetadata is frozen.
fun init(witness: TOKEN_TEMPLATE_STANDINGS, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        DECIMALS,                   // decimals (patched by client)
        b"TMPL",                    // symbol (patched by client)
        b"Template Token",          // name (patched by client)
        b"A faction token",         // description (patched by client)
        option::none(),             // icon_url
        ctx,
    );
    transfer::public_freeze_object(metadata);
    let registry_id = object::id_from_bytes(REGISTRY_ID_BYTES);
    market_standings::create_market(treasury, registry_id, MIN_MINT, MIN_TRADE, MIN_BUY, ctx);
}
