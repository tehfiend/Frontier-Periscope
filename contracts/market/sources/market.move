/// Market -- A governance token market with order book for SSU item trading.
///
/// Manages a TreasuryCap<T> for minting/burning governance tokens, plus
/// a sell-listing and buy-order book backed by dynamic fields.
module market::market {
    use sui::coin::{Self, Coin, TreasuryCap};
    use sui::clock::Clock;
    use sui::dynamic_field as df;
    use sui::event;

    // ── Error codes ──────────────────────────────────────────────────

    const ENotCreator: u64 = 0;
    const ENotAuthorized: u64 = 1;
    const ENotSeller: u64 = 2;
    const ENotBuyer: u64 = 3;
    const EInsufficientPayment: u64 = 4;
    const EAlreadyAuthorized: u64 = 5;
    const ENotInAuthorized: u64 = 6;

    // ── Core types ───────────────────────────────────────────────────

    public struct Market<phantom T> has key {
        id: UID,
        creator: address,
        authorized: vector<address>,
        treasury_cap: TreasuryCap<T>,
        fee_bps: u64,
        fee_recipient: address,
        next_sell_id: u64,
        next_buy_id: u64,
    }

    // ── Dynamic field keys ───────────────────────────────────────────

    public struct SellKey has copy, drop, store {
        listing_id: u64,
    }

    public struct BuyKey has copy, drop, store {
        order_id: u64,
    }

    public struct BuyCoinKey has copy, drop, store {
        order_id: u64,
    }

    // ── Order types ──────────────────────────────────────────────────

    public struct SellListing has drop, store {
        listing_id: u64,
        seller: address,
        ssu_id: ID,
        type_id: u64,
        price_per_unit: u64,
        quantity: u64,
        posted_at_ms: u64,
    }

    public struct BuyOrder has drop, store {
        order_id: u64,
        buyer: address,
        type_id: u64,
        price_per_unit: u64,
        quantity: u64,
        original_quantity: u64,
        posted_at_ms: u64,
    }

    // ── Events ───────────────────────────────────────────────────────

    public struct MarketCreatedEvent has copy, drop {
        market_id: ID,
        creator: address,
    }

    public struct MintEvent has copy, drop {
        market_id: ID,
        amount: u64,
        recipient: address,
        minter: address,
    }

    public struct BurnEvent has copy, drop {
        market_id: ID,
        amount: u64,
        burner: address,
    }

    public struct SellListingPostedEvent has copy, drop {
        market_id: ID,
        listing_id: u64,
        seller: address,
        ssu_id: ID,
        type_id: u64,
        price_per_unit: u64,
        quantity: u64,
        posted_at_ms: u64,
    }

    public struct SellListingUpdatedEvent has copy, drop {
        market_id: ID,
        listing_id: u64,
        price_per_unit: u64,
        quantity: u64,
    }

    public struct SellListingCancelledEvent has copy, drop {
        market_id: ID,
        listing_id: u64,
    }

    public struct BuyOrderPostedEvent has copy, drop {
        market_id: ID,
        order_id: u64,
        buyer: address,
        type_id: u64,
        price_per_unit: u64,
        quantity: u64,
        posted_at_ms: u64,
    }

    public struct BuyOrderFilledEvent has copy, drop {
        market_id: ID,
        order_id: u64,
        seller: address,
        buyer: address,
        type_id: u64,
        price_per_unit: u64,
        quantity: u64,
        total_paid: u64,
    }

    public struct BuyOrderCancelledEvent has copy, drop {
        market_id: ID,
        order_id: u64,
        buyer: address,
        type_id: u64,
        refund_amount: u64,
    }

    public struct AuthorizedAddedEvent has copy, drop {
        market_id: ID,
        addr: address,
    }

    public struct AuthorizedRemovedEvent has copy, drop {
        market_id: ID,
        addr: address,
    }

    // ── Create ───────────────────────────────────────────────────────

    /// Create a new shared Market. Sender becomes the creator/owner.
    /// fee_bps and fee_recipient default to 0 / sender.
    public fun create_market<T>(
        treasury_cap: TreasuryCap<T>,
        ctx: &mut TxContext,
    ) {
        let market = Market<T> {
            id: object::new(ctx),
            creator: ctx.sender(),
            authorized: vector::empty(),
            treasury_cap,
            fee_bps: 0,
            fee_recipient: ctx.sender(),
            next_sell_id: 0,
            next_buy_id: 0,
        };

        event::emit(MarketCreatedEvent {
            market_id: object::id(&market),
            creator: ctx.sender(),
        });

        transfer::share_object(market);
    }

    // ── Mint / Burn ──────────────────────────────────────────────────

    /// Mint tokens and transfer to recipient. Authorized callers only.
    public fun mint<T>(
        market: &mut Market<T>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        assert!(is_authorized(market, ctx.sender()), ENotAuthorized);

        let coin = coin::mint(&mut market.treasury_cap, amount, ctx);

        event::emit(MintEvent {
            market_id: object::id(market),
            amount,
            recipient,
            minter: ctx.sender(),
        });

        transfer::public_transfer(coin, recipient);
    }

    /// Burn tokens. Anyone who holds tokens can burn them.
    public fun burn<T>(
        market: &mut Market<T>,
        coin: Coin<T>,
        ctx: &TxContext,
    ) {
        let amount = coin.value();

        event::emit(BurnEvent {
            market_id: object::id(market),
            amount,
            burner: ctx.sender(),
        });

        coin::burn(&mut market.treasury_cap, coin);
    }

    /// Mint tokens and deposit directly into a Treasury. Single-TX mint-to-treasury.
    public fun mint_to_treasury<T>(
        market: &mut Market<T>,
        treasury: &mut treasury::treasury::Treasury,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(is_authorized(market, ctx.sender()), ENotAuthorized);

        let coin = coin::mint(&mut market.treasury_cap, amount, ctx);

        event::emit(MintEvent {
            market_id: object::id(market),
            amount,
            recipient: object::id_address(treasury),
            minter: ctx.sender(),
        });

        treasury::treasury::deposit(treasury, coin, ctx);
    }

    // ── Authorization ────────────────────────────────────────────────

    /// Check if an address is the creator or in the authorized list.
    public fun is_authorized<T>(market: &Market<T>, addr: address): bool {
        market.creator == addr || market.authorized.contains(&addr)
    }

    /// Add an address to the authorized list. Creator only.
    public fun add_authorized<T>(
        market: &mut Market<T>,
        addr: address,
        ctx: &TxContext,
    ) {
        assert!(market.creator == ctx.sender(), ENotCreator);
        assert!(!market.authorized.contains(&addr), EAlreadyAuthorized);

        market.authorized.push_back(addr);

        event::emit(AuthorizedAddedEvent {
            market_id: object::id(market),
            addr,
        });
    }

    /// Remove an address from the authorized list. Creator only.
    public fun remove_authorized<T>(
        market: &mut Market<T>,
        addr: address,
        ctx: &TxContext,
    ) {
        assert!(market.creator == ctx.sender(), ENotCreator);

        let (found, idx) = market.authorized.index_of(&addr);
        assert!(found, ENotInAuthorized);

        market.authorized.remove(idx);

        event::emit(AuthorizedRemovedEvent {
            market_id: object::id(market),
            addr,
        });
    }

    // ── Fee management ───────────────────────────────────────────────

    /// Update fee configuration. Creator only.
    public fun update_fee<T>(
        market: &mut Market<T>,
        fee_bps: u64,
        fee_recipient: address,
        ctx: &TxContext,
    ) {
        assert!(market.creator == ctx.sender(), ENotCreator);
        market.fee_bps = fee_bps;
        market.fee_recipient = fee_recipient;
    }

    // ── Sell listings ────────────────────────────────────────────────

    /// Post a new sell listing. Authorized callers only.
    public fun post_sell_listing<T>(
        market: &mut Market<T>,
        ssu_id: ID,
        type_id: u64,
        price_per_unit: u64,
        quantity: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(is_authorized(market, ctx.sender()), ENotAuthorized);

        let listing_id = market.next_sell_id;
        market.next_sell_id = listing_id + 1;

        let posted_at_ms = clock.timestamp_ms();

        let listing = SellListing {
            listing_id,
            seller: ctx.sender(),
            ssu_id,
            type_id,
            price_per_unit,
            quantity,
            posted_at_ms,
        };

        event::emit(SellListingPostedEvent {
            market_id: object::id(market),
            listing_id,
            seller: ctx.sender(),
            ssu_id,
            type_id,
            price_per_unit,
            quantity,
            posted_at_ms,
        });

        df::add(&mut market.id, SellKey { listing_id }, listing);
    }

    /// Update price and quantity on an existing sell listing. Seller only.
    public fun update_sell_listing<T>(
        market: &mut Market<T>,
        listing_id: u64,
        price_per_unit: u64,
        quantity: u64,
        ctx: &TxContext,
    ) {
        let listing: &mut SellListing = df::borrow_mut(
            &mut market.id,
            SellKey { listing_id },
        );
        assert!(listing.seller == ctx.sender(), ENotSeller);

        listing.price_per_unit = price_per_unit;
        listing.quantity = quantity;

        event::emit(SellListingUpdatedEvent {
            market_id: object::id(market),
            listing_id,
            price_per_unit,
            quantity,
        });
    }

    /// Cancel a sell listing. Seller only.
    public fun cancel_sell_listing<T>(
        market: &mut Market<T>,
        listing_id: u64,
        ctx: &TxContext,
    ) {
        let listing: SellListing = df::remove(
            &mut market.id,
            SellKey { listing_id },
        );
        assert!(listing.seller == ctx.sender(), ENotSeller);

        event::emit(SellListingCancelledEvent {
            market_id: object::id(market),
            listing_id,
        });
    }

    // ── Buy orders ───────────────────────────────────────────────────

    /// Post a new buy order with escrowed payment. Authorized callers only.
    public fun post_buy_order<T>(
        market: &mut Market<T>,
        coin: Coin<T>,
        type_id: u64,
        price_per_unit: u64,
        quantity: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(is_authorized(market, ctx.sender()), ENotAuthorized);

        let required = price_per_unit * quantity;
        assert!(coin.value() >= required, EInsufficientPayment);

        let order_id = market.next_buy_id;
        market.next_buy_id = order_id + 1;

        let posted_at_ms = clock.timestamp_ms();

        let order = BuyOrder {
            order_id,
            buyer: ctx.sender(),
            type_id,
            price_per_unit,
            quantity,
            original_quantity: quantity,
            posted_at_ms,
        };

        event::emit(BuyOrderPostedEvent {
            market_id: object::id(market),
            order_id,
            buyer: ctx.sender(),
            type_id,
            price_per_unit,
            quantity,
            posted_at_ms,
        });

        // Store the escrowed coin and the order as dynamic fields
        df::add(&mut market.id, BuyCoinKey { order_id }, coin);
        df::add(&mut market.id, BuyKey { order_id }, order);
    }

    /// Cancel a buy order and refund escrowed coin. Buyer only.
    public fun cancel_buy_order<T>(
        market: &mut Market<T>,
        order_id: u64,
        ctx: &mut TxContext,
    ) {
        let order: BuyOrder = df::remove(&mut market.id, BuyKey { order_id });
        assert!(order.buyer == ctx.sender(), ENotBuyer);

        let coin: Coin<T> = df::remove(&mut market.id, BuyCoinKey { order_id });
        let refund_amount = coin.value();

        event::emit(BuyOrderCancelledEvent {
            market_id: object::id(market),
            order_id,
            buyer: order.buyer,
            type_id: order.type_id,
            refund_amount,
        });

        transfer::public_transfer(coin, order.buyer);
    }

    /// Fill (partially or fully) an open buy order. Anyone can fill.
    /// Splits payment from the escrowed coin, applies fee, transfers payment to seller.
    public fun fill_buy_order<T>(
        market: &mut Market<T>,
        order_id: u64,
        type_id: u64,
        quantity: u64,
        ctx: &mut TxContext,
    ) {
        let order: &mut BuyOrder = df::borrow_mut(&mut market.id, BuyKey { order_id });
        assert!(order.type_id == type_id, ENotAuthorized);
        assert!(quantity <= order.quantity, EInsufficientPayment);

        let total_cost = order.price_per_unit * (quantity as u64);
        let buyer = order.buyer;
        let price_per_unit = order.price_per_unit;
        order.quantity = order.quantity - quantity;

        // Split payment from escrowed coin
        let escrowed: &mut Coin<T> = df::borrow_mut(&mut market.id, BuyCoinKey { order_id });
        let mut payment = escrowed.split(total_cost, ctx);

        // Apply fee
        let fee_amount = (total_cost * market.fee_bps) / 10000;
        if (fee_amount > 0 && payment.value() >= fee_amount) {
            let fee_coin = payment.split(fee_amount, ctx);
            transfer::public_transfer(fee_coin, market.fee_recipient);
        };

        event::emit(BuyOrderFilledEvent {
            market_id: object::id(market),
            order_id,
            seller: ctx.sender(),
            buyer,
            type_id,
            price_per_unit,
            quantity,
            total_paid: payment.value(),
        });

        transfer::public_transfer(payment, ctx.sender());

        // Clean up fully filled orders
        let remaining = {
            let o: &BuyOrder = df::borrow(&market.id, BuyKey { order_id });
            o.quantity
        };
        if (remaining == 0) {
            let _order: BuyOrder = df::remove(&mut market.id, BuyKey { order_id });
            let leftover: Coin<T> = df::remove(&mut market.id, BuyCoinKey { order_id });
            if (leftover.value() > 0) {
                transfer::public_transfer(leftover, buyer);
            } else {
                leftover.destroy_zero();
            };
        };
    }

    /// Buy items from a sell listing. Anyone can buy. Returns change coin.
    public fun buy_from_listing<T>(
        market: &mut Market<T>,
        listing_id: u64,
        quantity: u64,
        mut payment: Coin<T>,
        _clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<T> {
        let listing: &mut SellListing = df::borrow_mut(&mut market.id, SellKey { listing_id });
        assert!(quantity <= listing.quantity, EInsufficientPayment);

        let total_cost = listing.price_per_unit * (quantity as u64);
        assert!(payment.value() >= total_cost, EInsufficientPayment);

        let seller = listing.seller;
        listing.quantity = listing.quantity - quantity;

        // Split exact cost from payment
        let mut proceeds = payment.split(total_cost, ctx);

        // Apply fee
        let fee_amount = (total_cost * market.fee_bps) / 10000;
        if (fee_amount > 0 && proceeds.value() >= fee_amount) {
            let fee_coin = proceeds.split(fee_amount, ctx);
            transfer::public_transfer(fee_coin, market.fee_recipient);
        };

        // Pay seller
        transfer::public_transfer(proceeds, seller);

        // Clean up fully bought listings
        let remaining = {
            let l: &SellListing = df::borrow(&market.id, SellKey { listing_id });
            l.quantity
        };
        if (remaining == 0) {
            let _listing: SellListing = df::remove(&mut market.id, SellKey { listing_id });
        };

        // Return change
        payment
    }

    // ── Supply ───────────────────────────────────────────────────────

    /// Get the total supply of the managed token.
    public fun total_supply<T>(market: &Market<T>): u64 {
        coin::total_supply(&market.treasury_cap)
    }

    // ── Market accessors ─────────────────────────────────────────────

    public fun market_creator<T>(market: &Market<T>): address {
        market.creator
    }

    public fun market_fee_bps<T>(market: &Market<T>): u64 {
        market.fee_bps
    }

    public fun market_fee_recipient<T>(market: &Market<T>): address {
        market.fee_recipient
    }

    public fun next_sell_id<T>(market: &Market<T>): u64 {
        market.next_sell_id
    }

    public fun next_buy_id<T>(market: &Market<T>): u64 {
        market.next_buy_id
    }

    // ── Sell listing helpers ─────────────────────────────────────────

    public fun has_sell_listing<T>(market: &Market<T>, listing_id: u64): bool {
        df::exists_(&market.id, SellKey { listing_id })
    }

    public fun borrow_sell_listing<T>(market: &Market<T>, listing_id: u64): &SellListing {
        df::borrow(&market.id, SellKey { listing_id })
    }

    public fun borrow_sell_listing_mut<T>(market: &mut Market<T>, listing_id: u64): &mut SellListing {
        df::borrow_mut(&mut market.id, SellKey { listing_id })
    }

    public fun remove_sell_listing<T>(market: &mut Market<T>, listing_id: u64): SellListing {
        df::remove(&mut market.id, SellKey { listing_id })
    }

    public fun set_listing_quantity(listing: &mut SellListing, quantity: u64) {
        listing.quantity = quantity;
    }

    // ── Buy order helpers ────────────────────────────────────────────

    public fun has_buy_order<T>(market: &Market<T>, order_id: u64): bool {
        df::exists_(&market.id, BuyKey { order_id })
    }

    public fun borrow_buy_order<T>(market: &Market<T>, order_id: u64): &BuyOrder {
        df::borrow(&market.id, BuyKey { order_id })
    }

    public fun borrow_buy_order_mut<T>(market: &mut Market<T>, order_id: u64): &mut BuyOrder {
        df::borrow_mut(&mut market.id, BuyKey { order_id })
    }

    public fun remove_buy_order<T>(market: &mut Market<T>, order_id: u64): BuyOrder {
        df::remove(&mut market.id, BuyKey { order_id })
    }

    public fun set_order_quantity(order: &mut BuyOrder, quantity: u64) {
        order.quantity = quantity;
    }

    public fun remove_escrowed_coin<T>(market: &mut Market<T>, order_id: u64): Coin<T> {
        df::remove(&mut market.id, BuyCoinKey { order_id })
    }

    public fun split_escrowed_coin<T>(
        market: &mut Market<T>,
        order_id: u64,
        amount: u64,
        ctx: &mut TxContext,
    ): Coin<T> {
        let escrowed: &mut Coin<T> = df::borrow_mut(
            &mut market.id,
            BuyCoinKey { order_id },
        );
        coin::split(escrowed, amount, ctx)
    }

    // ── SellListing accessors ────────────────────────────────────────

    public fun listing_id(listing: &SellListing): u64 {
        listing.listing_id
    }

    public fun listing_seller(listing: &SellListing): address {
        listing.seller
    }

    public fun listing_ssu_id(listing: &SellListing): ID {
        listing.ssu_id
    }

    public fun listing_type_id(listing: &SellListing): u64 {
        listing.type_id
    }

    public fun listing_price_per_unit(listing: &SellListing): u64 {
        listing.price_per_unit
    }

    public fun listing_quantity(listing: &SellListing): u64 {
        listing.quantity
    }

    // ── BuyOrder accessors ───────────────────────────────────────────

    public fun order_id(order: &BuyOrder): u64 {
        order.order_id
    }

    public fun order_buyer(order: &BuyOrder): address {
        order.buyer
    }

    public fun order_type_id(order: &BuyOrder): u64 {
        order.type_id
    }

    public fun order_price_per_unit(order: &BuyOrder): u64 {
        order.price_per_unit
    }

    public fun order_quantity(order: &BuyOrder): u64 {
        order.quantity
    }

    public fun order_original_quantity(order: &BuyOrder): u64 {
        order.original_quantity
    }

    public fun order_posted_at_ms(order: &BuyOrder): u64 {
        order.posted_at_ms
    }
}
