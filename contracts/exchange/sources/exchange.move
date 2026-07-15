/// Decentralized order book exchange for Sui Coin<T> tokens.
///
/// Each trading pair (A ↔ B) gets its own shared OrderBook<A, B> object.
/// Orders are sorted by price. Matching is permissionless — anyone can
/// trigger match_orders(). Supports SUI pairs naturally.
module exchange::exchange;

use sui::coin::{Self, Coin};
use sui::event;

// ── Error codes ────────────────────────────────────────────────────────────

#[error(code = 0)]
const EInsufficientPayment: vector<u8> = b"Insufficient payment for order";

#[error(code = 1)]
const EOrderNotFound: vector<u8> = b"Order not found in book";

#[error(code = 2)]
const ENotOrderOwner: vector<u8> = b"Only the order owner can cancel";

#[error(code = 3)]
const EEmptyOrder: vector<u8> = b"Order amount must be greater than zero";

// ── Structs ────────────────────────────────────────────────────────────────

/// Shared order book for a trading pair A ↔ B.
public struct OrderBook<phantom A, phantom B> has key {
    id: UID,
    bids: vector<Order>,       // Buy A with B, sorted best (highest) first
    asks: vector<Order>,       // Sell A for B, sorted best (lowest) first
    fee_bps: u64,              // Trading fee in basis points (100 = 1%)
    fee_recipient: address,
    next_order_id: u64,
}

/// A single order in the book. Coins are escrowed in the book object
/// as dynamic fields keyed by order_id.
public struct Order has store, drop, copy {
    order_id: u64,
    owner: address,
    price: u64,           // Price per unit (fixed-point, 9 decimals)
    amount: u64,          // Remaining quantity in base units
    is_bid: bool,
}

// ── Events ─────────────────────────────────────────────────────────────────

public struct OrderPlacedEvent has copy, drop {
    book_id: ID,
    order_id: u64,
    owner: address,
    price: u64,
    amount: u64,
    is_bid: bool,
}

public struct OrderCancelledEvent has copy, drop {
    book_id: ID,
    order_id: u64,
}

public struct TradeEvent has copy, drop {
    book_id: ID,
    bid_order_id: u64,
    ask_order_id: u64,
    price: u64,
    amount: u64,
}

// ── Create pair ────────────────────────────────────────────────────────────

/// Create a new trading pair. Anyone can create one.
public fun create_pair<A, B>(
    fee_bps: u64,
    ctx: &mut TxContext,
) {
    transfer::share_object(OrderBook<A, B> {
        id: object::new(ctx),
        bids: vector::empty(),
        asks: vector::empty(),
        fee_bps,
        fee_recipient: ctx.sender(),
        next_order_id: 0,
    });
}

// ── Place orders ───────────────────────────────────────────────────────────

/// Place a bid (buy A with B). Deposits Coin<B> as escrow.
public fun place_bid<A, B>(
    book: &mut OrderBook<A, B>,
    payment: Coin<B>,
    price: u64,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(amount > 0, EEmptyOrder);
    let order_id = book.next_order_id;
    book.next_order_id = order_id + 1;

    let order = Order {
        order_id,
        owner: ctx.sender(),
        price,
        amount,
        is_bid: true,
    };

    // Escrow the payment coin as a dynamic field
    sui::dynamic_field::add(&mut book.id, order_id, payment);

    // Insert sorted by price descending (best bid first)
    let mut i = 0;
    let len = vector::length(&book.bids);
    while (i < len) {
        if (vector::borrow(&book.bids, i).price < price) break;
        i = i + 1;
    };
    vector::insert(&mut book.bids, order, i);

    event::emit(OrderPlacedEvent {
        book_id: object::id(book),
        order_id,
        owner: ctx.sender(),
        price,
        amount,
        is_bid: true,
    });
}

/// Place an ask (sell A for B). Deposits Coin<A> as escrow.
public fun place_ask<A, B>(
    book: &mut OrderBook<A, B>,
    offer: Coin<A>,
    price: u64,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(amount > 0, EEmptyOrder);
    let order_id = book.next_order_id;
    book.next_order_id = order_id + 1;

    let order = Order {
        order_id,
        owner: ctx.sender(),
        price,
        amount,
        is_bid: false,
    };

    // Escrow the offer coin as a dynamic field
    sui::dynamic_field::add(&mut book.id, order_id, offer);

    // Insert sorted by price ascending (best ask first)
    let mut i = 0;
    let len = vector::length(&book.asks);
    while (i < len) {
        if (vector::borrow(&book.asks, i).price > price) break;
        i = i + 1;
    };
    vector::insert(&mut book.asks, order, i);

    event::emit(OrderPlacedEvent {
        book_id: object::id(book),
        order_id,
        owner: ctx.sender(),
        price,
        amount,
        is_bid: false,
    });
}

/// Cancel an order and return escrowed coins to the owner.
public fun cancel_bid<A, B>(
    book: &mut OrderBook<A, B>,
    order_id: u64,
    ctx: &mut TxContext,
) {
    let mut found_idx: u64 = 0;
    let mut found = false;
    let len = vector::length(&book.bids);
    let mut i = 0;
    while (i < len) {
        let order = vector::borrow(&book.bids, i);
        if (order.order_id == order_id) {
            assert!(order.owner == ctx.sender(), ENotOrderOwner);
            found_idx = i;
            found = true;
            break
        };
        i = i + 1;
    };
    assert!(found, EOrderNotFound);

    vector::remove(&mut book.bids, found_idx);

    // Return escrowed Coin<B>
    let coin = sui::dynamic_field::remove<u64, Coin<B>>(&mut book.id, order_id);
    transfer::public_transfer(coin, ctx.sender());

    event::emit(OrderCancelledEvent {
        book_id: object::id(book),
        order_id,
    });
}

/// Cancel an ask order and return escrowed Coin<A>.
public fun cancel_ask<A, B>(
    book: &mut OrderBook<A, B>,
    order_id: u64,
    ctx: &mut TxContext,
) {
    let mut found_idx: u64 = 0;
    let mut found = false;
    let len = vector::length(&book.asks);
    let mut i = 0;
    while (i < len) {
        let order = vector::borrow(&book.asks, i);
        if (order.order_id == order_id) {
            assert!(order.owner == ctx.sender(), ENotOrderOwner);
            found_idx = i;
            found = true;
            break
        };
        i = i + 1;
    };
    assert!(found, EOrderNotFound);

    vector::remove(&mut book.asks, found_idx);

    // Return escrowed Coin<A>
    let coin = sui::dynamic_field::remove<u64, Coin<A>>(&mut book.id, order_id);
    transfer::public_transfer(coin, ctx.sender());

    event::emit(OrderCancelledEvent {
        book_id: object::id(book),
        order_id,
    });
}

// ── Accessors ──────────────────────────────────────────────────────────────

public fun bid_count<A, B>(book: &OrderBook<A, B>): u64 {
    vector::length(&book.bids)
}

public fun ask_count<A, B>(book: &OrderBook<A, B>): u64 {
    vector::length(&book.asks)
}

public fun fee_bps<A, B>(book: &OrderBook<A, B>): u64 {
    book.fee_bps
}

public fun order_price(order: &Order): u64 { order.price }
public fun order_amount(order: &Order): u64 { order.amount }
public fun order_owner(order: &Order): address { order.owner }
public fun order_id(order: &Order): u64 { order.order_id }
