/// OrgTreasury: shared-object wrapper around TreasuryCap<T>.
///
/// Once deposited, the TreasuryCap cannot be extracted. Any org stakeholder
/// can mint by calling treasury functions, which check governance::org::is_stakeholder_address().
module governance_ext::treasury;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::event;
use governance::org::Organization;

// -- Error codes ----------------------------------------------------------------

#[error(code = 0)]
const ENotStakeholder: vector<u8> = b"Only org stakeholders can use the treasury";

#[error(code = 1)]
const EOrgMismatch: vector<u8> = b"Organization does not match this treasury";

// -- Structs --------------------------------------------------------------------

/// Shared treasury object. One per org per token type.
public struct OrgTreasury<phantom T> has key {
    id: UID,
    org_id: ID,
    treasury_cap: TreasuryCap<T>,
}

// -- Events ---------------------------------------------------------------------

public struct TreasuryCreatedEvent has copy, drop {
    treasury_id: ID,
    org_id: ID,
}

public struct MintEvent has copy, drop {
    treasury_id: ID,
    amount: u64,
    recipient: address,
    minter: address,
}

public struct BurnEvent has copy, drop {
    treasury_id: ID,
    amount: u64,
    burner: address,
}

// -- Deposit TreasuryCap (one-time, irreversible) -------------------------------

/// Deposit a TreasuryCap into a new OrgTreasury shared object.
/// The caller must be a stakeholder of the organization.
/// After this call, the TreasuryCap is locked and cannot be extracted.
public fun deposit_treasury_cap<T>(
    org: &Organization,
    treasury_cap: TreasuryCap<T>,
    ctx: &mut TxContext,
) {
    assert!(governance::org::is_stakeholder_address(org, ctx.sender()), ENotStakeholder);

    let org_id = object::id(org);
    let treasury = OrgTreasury<T> {
        id: object::new(ctx),
        org_id,
        treasury_cap,
    };

    let treasury_id = object::id(&treasury);

    event::emit(TreasuryCreatedEvent { treasury_id, org_id });

    transfer::share_object(treasury);
}

// -- Mint (stakeholder only) ----------------------------------------------------

/// Mint tokens from the OrgTreasury. Caller must be an org stakeholder.
/// Returns the minted Coin<T> (caller decides where to send it).
public fun mint<T>(
    treasury: &mut OrgTreasury<T>,
    org: &Organization,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(object::id(org) == treasury.org_id, EOrgMismatch);
    assert!(governance::org::is_stakeholder_address(org, ctx.sender()), ENotStakeholder);

    let minted = coin::mint(&mut treasury.treasury_cap, amount, ctx);

    event::emit(MintEvent {
        treasury_id: object::id(treasury),
        amount,
        recipient,
        minter: ctx.sender(),
    });

    minted
}

/// Mint and transfer in one call (convenience entry function).
entry fun mint_and_transfer<T>(
    treasury: &mut OrgTreasury<T>,
    org: &Organization,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let coin = mint(treasury, org, amount, recipient, ctx);
    transfer::public_transfer(coin, recipient);
}

// -- Burn (any holder) ----------------------------------------------------------

/// Burn tokens. Any coin holder can burn their own tokens.
public fun burn<T>(
    treasury: &mut OrgTreasury<T>,
    coin: Coin<T>,
    ctx: &TxContext,
) {
    let amount = coin::value(&coin);
    coin::burn(&mut treasury.treasury_cap, coin);

    event::emit(BurnEvent {
        treasury_id: object::id(treasury),
        amount,
        burner: ctx.sender(),
    });
}

// -- Read accessors -------------------------------------------------------------

public fun total_supply<T>(treasury: &OrgTreasury<T>): u64 {
    coin::total_supply(&treasury.treasury_cap)
}

public fun org_id<T>(treasury: &OrgTreasury<T>): ID {
    treasury.org_id
}
