/// Template coin module for faction token creation.
///
/// This module is compiled once and its bytecodes are patched at runtime
/// to create custom tokens. The client replaces:
///   - Module name: TOKEN_TEMPLATE -> USER_TOKEN_NAME
///   - OTW struct name: TOKEN_TEMPLATE -> USER_TOKEN_NAME
///   - Metadata byte vectors: symbol, name, description
///
/// After publishing, a Market<T> is created automatically with the
/// TreasuryCap locked inside. Authorized addresses mint/burn via Market.
module token_template::TOKEN_TEMPLATE;

use sui::coin;
use market::market;

/// One-Time Witness for the token. Struct name gets patched.
public struct TOKEN_TEMPLATE has drop {}

/// Initialize the token currency. Creates TreasuryCap + CoinMetadata.
/// TreasuryCap is consumed by market::create_market (locked inside Market<T>).
/// CoinMetadata is frozen.
fun init(witness: TOKEN_TEMPLATE, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        9,                          // decimals
        b"TMPL",                    // symbol (patched by client)
        b"Template Token",          // name (patched by client)
        b"A faction token",         // description (patched by client)
        option::none(),             // icon_url
        ctx,
    );
    transfer::public_freeze_object(metadata);
    market::create_market(treasury, ctx);
}
