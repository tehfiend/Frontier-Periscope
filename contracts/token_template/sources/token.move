/// Template coin module for faction token creation.
///
/// This module is compiled once and its bytecodes are patched at runtime
/// to create custom tokens. The client replaces:
///   - Module name: TOKEN_TEMPLATE → USER_TOKEN_NAME
///   - OTW struct name: TOKEN_TEMPLATE → USER_TOKEN_NAME
///   - Metadata byte vectors: symbol, name, description
///
/// After publishing, the TreasuryCap holder can mint/burn tokens.
module token_template::TOKEN_TEMPLATE;

use sui::coin;

/// One-Time Witness for the token. Struct name gets patched.
public struct TOKEN_TEMPLATE has drop {}

/// Initialize the token currency. Creates TreasuryCap + CoinMetadata.
/// TreasuryCap is transferred to the publisher. CoinMetadata is frozen.
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
    transfer::public_transfer(treasury, ctx.sender());
    transfer::public_freeze_object(metadata);
}

/// Mint new tokens. Only the TreasuryCap holder can call this.
public entry fun mint<T>(
    treasury: &mut coin::TreasuryCap<T>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let minted = coin::mint(treasury, amount, ctx);
    transfer::public_transfer(minted, recipient);
}

/// Burn tokens. Only the TreasuryCap holder can call this.
public entry fun burn<T>(
    treasury: &mut coin::TreasuryCap<T>,
    coin: coin::Coin<T>,
) {
    coin::burn(treasury, coin);
}
