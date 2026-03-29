/// Treasury -- A shared multi-user wallet for holding Coin<T> balances.
///
/// Supports multiple coin types via phantom-typed dynamic fields.
/// Owner can manage admins. Deposits are open to anyone (enables
/// gate extensions to deposit toll revenue). Withdrawals require
/// owner or admin.
module treasury::treasury {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::dynamic_field as df;
    use sui::event;

    // ── Error codes ────────────────────────────────────────────────────

    const ENotOwner: u64 = 0;
    const ENotAuthorized: u64 = 1;
    const EInsufficientBalance: u64 = 2;
    const EAdminAlreadyExists: u64 = 3;
    const EAdminNotFound: u64 = 4;

    // ── Types ──────────────────────────────────────────────────────────

    /// The shared Treasury object.
    public struct Treasury has key, store {
        id: UID,
        owner: address,
        admins: vector<address>,
        name: vector<u8>,
    }

    /// Phantom-typed key for Balance<T> dynamic fields.
    public struct BalanceKey<phantom T> has copy, drop, store {}

    // ── Events ─────────────────────────────────────────────────────────

    public struct TreasuryCreatedEvent has copy, drop {
        treasury_id: ID,
        owner: address,
        name: vector<u8>,
    }

    public struct DepositEvent has copy, drop {
        treasury_id: ID,
        depositor: address,
        amount: u64,
    }

    public struct WithdrawEvent has copy, drop {
        treasury_id: ID,
        withdrawer: address,
        amount: u64,
    }

    public struct AdminAddedEvent has copy, drop {
        treasury_id: ID,
        admin: address,
    }

    public struct AdminRemovedEvent has copy, drop {
        treasury_id: ID,
        admin: address,
    }

    // ── Create ─────────────────────────────────────────────────────────

    /// Create a new shared Treasury. Sender becomes the owner.
    public fun create_treasury(
        name: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let treasury = Treasury {
            id: object::new(ctx),
            owner: ctx.sender(),
            admins: vector::empty(),
            name,
        };

        event::emit(TreasuryCreatedEvent {
            treasury_id: object::id(&treasury),
            owner: ctx.sender(),
            name,
        });

        transfer::share_object(treasury);
    }

    // ── Admin management (owner only) ──────────────────────────────────

    /// Add an admin. Owner only.
    public fun add_admin(
        treasury: &mut Treasury,
        admin: address,
        ctx: &TxContext,
    ) {
        assert!(treasury.owner == ctx.sender(), ENotOwner);
        assert!(!treasury.admins.contains(&admin), EAdminAlreadyExists);

        treasury.admins.push_back(admin);

        event::emit(AdminAddedEvent {
            treasury_id: object::id(treasury),
            admin,
        });
    }

    /// Remove an admin. Owner only.
    public fun remove_admin(
        treasury: &mut Treasury,
        admin: address,
        ctx: &TxContext,
    ) {
        assert!(treasury.owner == ctx.sender(), ENotOwner);

        let (found, idx) = treasury.admins.index_of(&admin);
        assert!(found, EAdminNotFound);

        treasury.admins.remove(idx);

        event::emit(AdminRemovedEvent {
            treasury_id: object::id(treasury),
            admin,
        });
    }

    /// Transfer ownership. Owner only.
    public fun transfer_ownership(
        treasury: &mut Treasury,
        new_owner: address,
        ctx: &TxContext,
    ) {
        assert!(treasury.owner == ctx.sender(), ENotOwner);
        treasury.owner = new_owner;
    }

    // ── Deposit (open to anyone) ───────────────────────────────────────

    /// Deposit Coin<T> into the treasury. Open to anyone.
    public fun deposit<T>(
        treasury: &mut Treasury,
        coin: Coin<T>,
        ctx: &TxContext,
    ) {
        let amount = coin.value();
        let coin_balance = coin::into_balance(coin);

        if (df::exists_(&treasury.id, BalanceKey<T> {})) {
            let existing: &mut Balance<T> = df::borrow_mut(&mut treasury.id, BalanceKey<T> {});
            balance::join(existing, coin_balance);
        } else {
            df::add(&mut treasury.id, BalanceKey<T> {}, coin_balance);
        };

        event::emit(DepositEvent {
            treasury_id: object::id(treasury),
            depositor: ctx.sender(),
            amount,
        });
    }

    // ── Withdraw (owner or admin) ──────────────────────────────────────

    /// Withdraw Coin<T> from the treasury. Owner or admin only.
    public fun withdraw<T>(
        treasury: &mut Treasury,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(is_authorized(treasury, ctx.sender()), ENotAuthorized);
        assert!(df::exists_(&treasury.id, BalanceKey<T> {}), EInsufficientBalance);

        let existing: &mut Balance<T> = df::borrow_mut(&mut treasury.id, BalanceKey<T> {});
        assert!(balance::value(existing) >= amount, EInsufficientBalance);

        let withdrawn = balance::split(existing, amount);
        let coin = coin::from_balance(withdrawn, ctx);

        transfer::public_transfer(coin, ctx.sender());

        event::emit(WithdrawEvent {
            treasury_id: object::id(treasury),
            withdrawer: ctx.sender(),
            amount,
        });
    }

    // ── View helpers ───────────────────────────────────────────────────

    /// Check if an address is the owner or an admin.
    public fun is_authorized(treasury: &Treasury, addr: address): bool {
        treasury.owner == addr || treasury.admins.contains(&addr)
    }

    /// Get the balance of a specific Coin<T> type. Returns 0 if not present.
    public fun balance_of<T>(treasury: &Treasury): u64 {
        if (df::exists_(&treasury.id, BalanceKey<T> {})) {
            let b: &Balance<T> = df::borrow(&treasury.id, BalanceKey<T> {});
            balance::value(b)
        } else {
            0
        }
    }
}
