/// Lease system: prepaid rent for space/assembly access.
///
/// Landlords create leases specifying a rate per day. Tenants deposit
/// funds to prepay rent. Rent is lazily deducted when access is checked.
/// Integrates with gate/SSU extensions to gate access on active lease.
module lease::lease;

use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::dynamic_field;
use sui::event;

// ── Error codes ────────────────────────────────────────────────────────────

#[error(code = 0)]
const ENotLandlord: vector<u8> = b"Only the landlord can manage this lease";

#[error(code = 1)]
const ELeaseNotFound: vector<u8> = b"No lease found for this assembly";

#[error(code = 2)]
const ENotTenant: vector<u8> = b"Only the tenant can deposit rent";

#[error(code = 3)]
const ELeaseExpired: vector<u8> = b"Lease has expired (balance depleted)";

// ── Structs ────────────────────────────────────────────────────────────────

/// Shared registry of all leases managed by a landlord.
public struct LeaseRegistry has key {
    id: UID,
    admin: address,
}

/// Per-assembly lease record stored as a dynamic field.
/// The prepaid Coin<T> balance is stored as a separate dynamic field.
public struct LeaseRecord has store, drop {
    tenant: address,
    tenant_tribe: u32,
    rate_per_day: u64,
    last_charged_at: u64,
    landlord: address,
    balance_amount: u64,
}

// ── Events ─────────────────────────────────────────────────────────────────

public struct LeaseCreatedEvent has copy, drop {
    registry_id: ID,
    assembly_id: ID,
    tenant: address,
    rate_per_day: u64,
}

public struct RentCollectedEvent has copy, drop {
    registry_id: ID,
    assembly_id: ID,
    amount: u64,
    remaining_balance: u64,
}

public struct LeaseCancelledEvent has copy, drop {
    registry_id: ID,
    assembly_id: ID,
    refund_amount: u64,
}

// ── Init ───────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    transfer::share_object(LeaseRegistry {
        id: object::new(ctx),
        admin: ctx.sender(),
    });
}

// ── Lease management ───────────────────────────────────────────────────────

/// Create a lease offer for an assembly. Landlord only.
public fun create_lease(
    registry: &mut LeaseRegistry,
    assembly_id: ID,
    tenant: address,
    tenant_tribe: u32,
    rate_per_day: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == registry.admin, ENotLandlord);

    let record = LeaseRecord {
        tenant,
        tenant_tribe,
        rate_per_day,
        last_charged_at: clock.timestamp_ms(),
        landlord: ctx.sender(),
        balance_amount: 0,
    };

    dynamic_field::add(&mut registry.id, assembly_id, record);

    event::emit(LeaseCreatedEvent {
        registry_id: object::id(registry),
        assembly_id,
        tenant,
        rate_per_day,
    });
}

/// Tenant deposits rent payment.
public fun deposit_rent<T>(
    registry: &mut LeaseRegistry,
    assembly_id: ID,
    payment: Coin<T>,
    ctx: &TxContext,
) {
    assert!(dynamic_field::exists_(&registry.id, assembly_id), ELeaseNotFound);
    let record = dynamic_field::borrow_mut<ID, LeaseRecord>(&mut registry.id, assembly_id);
    assert!(ctx.sender() == record.tenant, ENotTenant);

    let amount = coin::value(&payment);
    record.balance_amount = record.balance_amount + amount;

    // Store or merge coin in dynamic field
    let coin_key = object::id_from_address(@0x1); // sentinel key for coins
    if (dynamic_field::exists_(&registry.id, coin_key)) {
        let existing = dynamic_field::borrow_mut<ID, Coin<T>>(&mut registry.id, coin_key);
        coin::join(existing, payment);
    } else {
        dynamic_field::add(&mut registry.id, coin_key, payment);
    };
}

/// Check if a lease is active. Deducts accrued rent from balance.
/// Returns true if balance > 0 after deduction.
/// Called by gate/SSU extensions to verify access.
public fun is_lease_active(
    registry: &mut LeaseRegistry,
    assembly_id: ID,
    clock: &Clock,
): bool {
    if (!dynamic_field::exists_(&registry.id, assembly_id)) return false;

    let registry_id = object::id(registry);
    let record = dynamic_field::borrow_mut<ID, LeaseRecord>(&mut registry.id, assembly_id);
    let now = clock.timestamp_ms();
    let elapsed_ms = now - record.last_charged_at;

    // Calculate rent owed: rate_per_day * elapsed_days
    // Using millisecond precision: 1 day = 86_400_000 ms
    let rent_owed = (record.rate_per_day * elapsed_ms) / 86_400_000;

    if (rent_owed > 0) {
        if (rent_owed >= record.balance_amount) {
            // Balance depleted
            record.balance_amount = 0;
            record.last_charged_at = now;
            return false
        };

        record.balance_amount = record.balance_amount - rent_owed;
        record.last_charged_at = now;

        event::emit(RentCollectedEvent {
            registry_id,
            assembly_id,
            amount: rent_owed,
            remaining_balance: record.balance_amount,
        });
    };

    record.balance_amount > 0
}

/// Cancel a lease. Tenant gets remaining balance back.
public fun cancel_lease<T>(
    registry: &mut LeaseRegistry,
    assembly_id: ID,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(dynamic_field::exists_(&registry.id, assembly_id), ELeaseNotFound);

    let record = dynamic_field::borrow<ID, LeaseRecord>(&registry.id, assembly_id);
    let is_tenant = ctx.sender() == record.tenant;
    let is_landlord = ctx.sender() == record.landlord;
    assert!(is_tenant || is_landlord, ENotTenant);

    // Charge any remaining rent
    let _active = is_lease_active(registry, assembly_id, clock);

    let record = dynamic_field::remove<ID, LeaseRecord>(&mut registry.id, assembly_id);
    let refund = record.balance_amount;

    // Return remaining coins to tenant
    if (refund > 0) {
        let coin_key = object::id_from_address(@0x1);
        if (dynamic_field::exists_(&registry.id, coin_key)) {
            let mut coins = dynamic_field::remove<ID, Coin<T>>(&mut registry.id, coin_key);
            let refund_coin = coin::split(&mut coins, refund, ctx);
            transfer::public_transfer(refund_coin, record.tenant);
            // Put remaining coins back if any
            if (coin::value(&coins) > 0) {
                dynamic_field::add(&mut registry.id, coin_key, coins);
            } else {
                coin::destroy_zero(coins);
            };
        };
    };

    event::emit(LeaseCancelledEvent {
        registry_id: object::id(registry),
        assembly_id,
        refund_amount: refund,
    });
}

// ── Read accessors ─────────────────────────────────────────────────────────

public fun has_lease(registry: &LeaseRegistry, assembly_id: ID): bool {
    dynamic_field::exists_(&registry.id, assembly_id)
}

public fun lease_balance(registry: &LeaseRegistry, assembly_id: ID): u64 {
    dynamic_field::borrow<ID, LeaseRecord>(&registry.id, assembly_id).balance_amount
}

public fun lease_rate(registry: &LeaseRegistry, assembly_id: ID): u64 {
    dynamic_field::borrow<ID, LeaseRecord>(&registry.id, assembly_id).rate_per_day
}

public fun lease_tenant(registry: &LeaseRegistry, assembly_id: ID): address {
    dynamic_field::borrow<ID, LeaseRecord>(&registry.id, assembly_id).tenant
}
