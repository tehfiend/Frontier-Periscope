/// Gate extension: toll-based access control with Coin<T> payment.
///
/// Requires payment of a configurable fee to jump through the gate.
/// Supports a free-pass list for allies (tribe/character-based).
/// Hybrid with permissions: allies jump free, strangers pay.
module gate_toll::gate_toll;

use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::dynamic_field;
use sui::event;
use world::{character::Character, gate::{Self, Gate}, in_game_id};

// ── Error codes ────────────────────────────────────────────────────────────

#[error(code = 0)]
const ENotAuthorized: vector<u8> = b"Caller is not authorized to modify toll config";

#[error(code = 1)]
const EGateNotConfigured: vector<u8> = b"Gate has no toll config set";

#[error(code = 2)]
const EInsufficientPayment: vector<u8> = b"Payment amount is less than the toll fee";

// ── Structs ────────────────────────────────────────────────────────────────

/// Typed witness for extension authorization.
public struct TollAuth has drop {}

/// Shared config object holding per-gate toll settings.
public struct TollConfig has key {
    id: UID,
    admin: address,
}

/// Per-gate toll configuration stored as a dynamic field.
public struct GateToll has store, drop {
    fee: u64,
    fee_recipient: address,
    permit_duration_ms: u64,
    free_tribes: vector<u32>,
    free_characters: vector<u64>,
}

/// Emitted when a toll is collected.
public struct TollCollectedEvent has copy, drop {
    gate_id: ID,
    payer: address,
    amount: u64,
}

// ── Init ───────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(TollConfig {
        id: object::new(ctx),
        admin: ctx.sender(),
    });
}

// ── Config management ──────────────────────────────────────────────────────

/// Set toll config for a gate. Admin only.
public fun set_toll(
    config: &mut TollConfig,
    gate_id: ID,
    fee: u64,
    fee_recipient: address,
    permit_duration_ms: u64,
    free_tribes: vector<u32>,
    free_characters: vector<u64>,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == config.admin, ENotAuthorized);

    let toll = GateToll {
        fee,
        fee_recipient,
        permit_duration_ms,
        free_tribes,
        free_characters,
    };

    if (dynamic_field::exists_(&config.id, gate_id)) {
        *dynamic_field::borrow_mut<ID, GateToll>(&mut config.id, gate_id) = toll;
    } else {
        dynamic_field::add(&mut config.id, gate_id, toll);
    };
}

// ── Gate entry point ───────────────────────────────────────────────────────

/// Pay toll and receive a jump permit.
/// Characters in the free list jump without payment.
public fun can_jump<T>(
    source_gate: &Gate,
    destination_gate: &Gate,
    character: &Character,
    mut payment: Coin<T>,
    config: &TollConfig,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let gate_id = object::id(source_gate);
    assert!(dynamic_field::exists_(&config.id, gate_id), EGateNotConfigured);

    let toll = dynamic_field::borrow<ID, GateToll>(&config.id, gate_id);
    let char_tribe = character.tribe();
    let char_id = in_game_id::item_id(&character.key());

    // Check if character is in the free list
    let is_free = vector::contains(&toll.free_tribes, &char_tribe)
        || vector::contains(&toll.free_characters, &char_id);

    if (!is_free) {
        // Require payment
        assert!(coin::value(&payment) >= toll.fee, EInsufficientPayment);

        // Split fee from payment, send to recipient
        let fee_coin = coin::split(&mut payment, toll.fee, ctx);
        transfer::public_transfer(fee_coin, toll.fee_recipient);

        event::emit(TollCollectedEvent {
            gate_id,
            payer: ctx.sender(),
            amount: toll.fee,
        });
    };

    // Return any change to the sender
    if (coin::value(&payment) > 0) {
        transfer::public_transfer(payment, ctx.sender());
    } else {
        coin::destroy_zero(payment);
    };

    let expires_at = clock.timestamp_ms() + toll.permit_duration_ms;

    gate::issue_jump_permit<TollAuth>(
        source_gate,
        destination_gate,
        character,
        TollAuth {},
        expires_at,
        ctx,
    );
}

// ── Read accessors ─────────────────────────────────────────────────────────

public fun has_toll(config: &TollConfig, gate_id: ID): bool {
    dynamic_field::exists_(&config.id, gate_id)
}

public fun toll_fee(config: &TollConfig, gate_id: ID): u64 {
    dynamic_field::borrow<ID, GateToll>(&config.id, gate_id).fee
}
