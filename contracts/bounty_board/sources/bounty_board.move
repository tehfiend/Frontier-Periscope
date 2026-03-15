/// Bounty board: escrow contract for player bounties.
///
/// Posters lock Coin<T> in escrow. Hunters claim bounties by providing
/// a Killmail proving they killed the target. Supports expiration.
module bounty_board::bounty_board;

use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::dynamic_field;
use sui::event;

// ── Error codes ────────────────────────────────────────────────────────────

#[error(code = 0)]
const EBountyNotFound: vector<u8> = b"Bounty not found";

#[error(code = 1)]
const ENotPoster: vector<u8> = b"Only the bounty poster can cancel";

#[error(code = 2)]
const EBountyExpired: vector<u8> = b"Bounty has expired";

#[error(code = 3)]
const ETargetMismatch: vector<u8> = b"Killmail victim does not match bounty target";

#[error(code = 4)]
const EEmptyReward: vector<u8> = b"Bounty reward must be greater than zero";

// ── Structs ────────────────────────────────────────────────────────────────

/// Shared bounty board. All bounties are stored as dynamic fields.
public struct BountyBoard has key {
    id: UID,
    next_bounty_id: u64,
}

/// A bounty record (metadata only — coins stored separately as dynamic fields).
public struct BountyRecord has store, drop {
    bounty_id: u64,
    poster: address,
    target_character_id: u64,
    reward_amount: u64,
    expires_at: u64,           // 0 = no expiration
}

// ── Events ─────────────────────────────────────────────────────────────────

public struct BountyPostedEvent has copy, drop {
    board_id: ID,
    bounty_id: u64,
    poster: address,
    target_character_id: u64,
    reward_amount: u64,
    expires_at: u64,
}

public struct BountyClaimedEvent has copy, drop {
    board_id: ID,
    bounty_id: u64,
    hunter: address,
    reward_amount: u64,
}

public struct BountyCancelledEvent has copy, drop {
    board_id: ID,
    bounty_id: u64,
}

// ── Init ───────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(BountyBoard {
        id: object::new(ctx),
        next_bounty_id: 0,
    });
}

// ── Post bounty ────────────────────────────────────────────────────────────

/// Post a bounty. Locks Coin<T> in escrow on the board.
public fun post_bounty<T>(
    board: &mut BountyBoard,
    target_character_id: u64,
    reward: Coin<T>,
    expires_at: u64,
    ctx: &mut TxContext,
) {
    let reward_amount = coin::value(&reward);
    assert!(reward_amount > 0, EEmptyReward);

    let bounty_id = board.next_bounty_id;
    board.next_bounty_id = bounty_id + 1;

    let record = BountyRecord {
        bounty_id,
        poster: ctx.sender(),
        target_character_id,
        reward_amount,
        expires_at,
    };

    // Store record and escrowed coins as dynamic fields
    // Use bounty_id for the record, bounty_id + max for coins
    dynamic_field::add(&mut board.id, bounty_id, record);

    // Store coins with a prefixed key to avoid collision
    let coin_key = bounty_id + 1_000_000_000;
    dynamic_field::add(&mut board.id, coin_key, reward);

    event::emit(BountyPostedEvent {
        board_id: object::id(board),
        bounty_id,
        poster: ctx.sender(),
        target_character_id,
        reward_amount,
        expires_at,
    });
}

// ── Claim bounty ───────────────────────────────────────────────────────────

/// Claim a bounty. The hunter provides the target_character_id to prove
/// they killed the target. Full killmail verification is done off-chain
/// by the frontend before calling this.
///
/// Note: On-chain killmail verification requires passing &Killmail and
/// checking killer_id. This simplified version trusts the caller for now.
/// TODO: Add Killmail parameter when the struct fields are confirmed.
public fun claim_bounty<T>(
    board: &mut BountyBoard,
    bounty_id: u64,
    _target_character_id: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(dynamic_field::exists_(&board.id, bounty_id), EBountyNotFound);

    let record = dynamic_field::borrow<u64, BountyRecord>(&board.id, bounty_id);
    assert!(record.target_character_id == _target_character_id, ETargetMismatch);

    // Check expiration
    if (record.expires_at > 0) {
        assert!(clock.timestamp_ms() <= record.expires_at, EBountyExpired);
    };

    let reward_amount = record.reward_amount;

    // Remove record
    dynamic_field::remove<u64, BountyRecord>(&mut board.id, bounty_id);

    // Transfer escrowed coins to the hunter
    let coin_key = bounty_id + 1_000_000_000;
    let reward = dynamic_field::remove<u64, Coin<T>>(&mut board.id, coin_key);
    transfer::public_transfer(reward, ctx.sender());

    event::emit(BountyClaimedEvent {
        board_id: object::id(board),
        bounty_id,
        hunter: ctx.sender(),
        reward_amount,
    });
}

// ── Cancel bounty ──────────────────────────────────────────────────────────

/// Cancel a bounty. Returns escrowed coins to the poster.
public fun cancel_bounty<T>(
    board: &mut BountyBoard,
    bounty_id: u64,
    ctx: &mut TxContext,
) {
    assert!(dynamic_field::exists_(&board.id, bounty_id), EBountyNotFound);

    let record = dynamic_field::borrow<u64, BountyRecord>(&board.id, bounty_id);
    assert!(record.poster == ctx.sender(), ENotPoster);

    // Remove record
    dynamic_field::remove<u64, BountyRecord>(&mut board.id, bounty_id);

    // Return escrowed coins
    let coin_key = bounty_id + 1_000_000_000;
    let reward = dynamic_field::remove<u64, Coin<T>>(&mut board.id, coin_key);
    transfer::public_transfer(reward, ctx.sender());

    event::emit(BountyCancelledEvent {
        board_id: object::id(board),
        bounty_id,
    });
}

// ── Read accessors ─────────────────────────────────────────────────────────

public fun has_bounty(board: &BountyBoard, bounty_id: u64): bool {
    dynamic_field::exists_(&board.id, bounty_id)
}

public fun bounty_count(board: &BountyBoard): u64 {
    board.next_bounty_id
}
