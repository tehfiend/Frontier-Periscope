/// Governance Claims — on-chain system sovereignty claims.
///
/// Uses a shared ClaimsRegistry with dynamic fields keyed by (org_id, system_id).
/// Sui dynamic fields can't be queried by partial key, so Periscope polls
/// ClaimCreatedEvent / ClaimRemovedEvent to build a local index.
///
/// Contested logic is Periscope-side: group claims by systemId,
/// >1 org = contested, highest weight = controller.
module governance::claims;

use sui::{dynamic_field as df, event, clock::Clock};
use governance::org::Organization;

// ── Error codes ──────────────────────────────────────────────────────────

#[error(code = 0)]
const ENotStakeholder: vector<u8> = b"Only org stakeholders can manage claims";

#[error(code = 1)]
const EClaimExists: vector<u8> = b"Claim already exists for this org + system";

#[error(code = 2)]
const EClaimNotFound: vector<u8> = b"No claim found for this org + system";

// ── Types ────────────────────────────────────────────────────────────────

public struct ClaimsRegistry has key {
    id: UID,
    total_claims: u64,
}

/// Composite key for dynamic field lookup
public struct ClaimKey has store, copy, drop {
    org_id: ID,
    system_id: u64,
}

public struct SystemClaim has store, drop {
    org_id: ID,
    system_id: u64,
    name: vector<u8>,
    claimed_at: u64,
    weight: u64,
}

// ── Events ───────────────────────────────────────────────────────────────

public struct ClaimCreatedEvent has copy, drop {
    registry_id: ID,
    org_id: ID,
    system_id: u64,
    name: vector<u8>,
    weight: u64,
}

public struct ClaimUpdatedEvent has copy, drop {
    registry_id: ID,
    org_id: ID,
    system_id: u64,
    name: vector<u8>,
    weight: u64,
}

public struct ClaimRemovedEvent has copy, drop {
    registry_id: ID,
    org_id: ID,
    system_id: u64,
}

// ── Init ─────────────────────────────────────────────────────────────────

fun init(ctx: &mut TxContext) {
    let registry = ClaimsRegistry {
        id: object::new(ctx),
        total_claims: 0,
    };
    transfer::share_object(registry);
}

// ── Claim management ─────────────────────────────────────────────────────

/// Create a new system claim. Stakeholder only.
entry fun create_claim(
    registry: &mut ClaimsRegistry,
    org: &Organization,
    system_id: u64,
    name: vector<u8>,
    weight: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_org_stakeholder(org, ctx);

    let org_id = object::id(org);
    let key = ClaimKey { org_id, system_id };
    assert!(!df::exists_(&registry.id, key), EClaimExists);

    let claim = SystemClaim {
        org_id,
        system_id,
        name,
        claimed_at: clock.timestamp_ms(),
        weight,
    };

    df::add(&mut registry.id, key, claim);
    registry.total_claims = registry.total_claims + 1;

    event::emit(ClaimCreatedEvent {
        registry_id: object::id(registry),
        org_id,
        system_id,
        name,
        weight,
    });
}

/// Update the name on an existing claim. Stakeholder only.
entry fun update_claim_name(
    registry: &mut ClaimsRegistry,
    org: &Organization,
    system_id: u64,
    name: vector<u8>,
    ctx: &TxContext,
) {
    assert_org_stakeholder(org, ctx);

    let org_id = object::id(org);
    let key = ClaimKey { org_id, system_id };
    assert!(df::exists_(&registry.id, key), EClaimNotFound);

    let registry_id = object::id(registry);
    let claim = df::borrow_mut<ClaimKey, SystemClaim>(&mut registry.id, key);
    claim.name = name;

    event::emit(ClaimUpdatedEvent {
        registry_id,
        org_id,
        system_id,
        name,
        weight: claim.weight,
    });
}

/// Update the weight on an existing claim. Stakeholder only.
entry fun update_claim_weight(
    registry: &mut ClaimsRegistry,
    org: &Organization,
    system_id: u64,
    weight: u64,
    ctx: &TxContext,
) {
    assert_org_stakeholder(org, ctx);

    let org_id = object::id(org);
    let key = ClaimKey { org_id, system_id };
    assert!(df::exists_(&registry.id, key), EClaimNotFound);

    let registry_id = object::id(registry);
    let claim = df::borrow_mut<ClaimKey, SystemClaim>(&mut registry.id, key);
    claim.weight = weight;

    event::emit(ClaimUpdatedEvent {
        registry_id,
        org_id,
        system_id,
        name: claim.name,
        weight,
    });
}

/// Remove a claim. Stakeholder only.
entry fun remove_claim(
    registry: &mut ClaimsRegistry,
    org: &Organization,
    system_id: u64,
    ctx: &TxContext,
) {
    assert_org_stakeholder(org, ctx);

    let org_id = object::id(org);
    let key = ClaimKey { org_id, system_id };
    assert!(df::exists_(&registry.id, key), EClaimNotFound);

    let _claim = df::remove<ClaimKey, SystemClaim>(&mut registry.id, key);
    registry.total_claims = registry.total_claims - 1;

    event::emit(ClaimRemovedEvent {
        registry_id: object::id(registry),
        org_id,
        system_id,
    });
}

// ── Read functions ───────────────────────────────────────────────────────

public fun has_claim(registry: &ClaimsRegistry, org_id: ID, system_id: u64): bool {
    df::exists_(&registry.id, ClaimKey { org_id, system_id })
}

public fun total_claims(registry: &ClaimsRegistry): u64 {
    registry.total_claims
}

// ── Internal ─────────────────────────────────────────────────────────────

fun assert_org_stakeholder(org: &Organization, ctx: &TxContext) {
    let sender = ctx.sender();
    assert!(
        governance::org::is_stakeholder_address(org, sender),
        ENotStakeholder,
    );
}

// ── Tests ────────────────────────────────────────────────────────────────

#[test_only]
use sui::test_scenario;

#[test_only]
use sui::clock;

#[test]
fun test_create_and_remove_claim() {
    let creator = @0xCAFE;
    let mut scenario = test_scenario::begin(creator);

    // Create registry via init
    {
        let registry = ClaimsRegistry {
            id: object::new(scenario.ctx()),
            total_claims: 0,
        };
        transfer::share_object(registry);
    };

    // Create org
    scenario.next_tx(creator);
    {
        let org = governance::org::create_org(b"Test Org", scenario.ctx());
        governance::org::share_for_testing(org);
    };

    // Create claim
    scenario.next_tx(creator);
    {
        let mut registry = scenario.take_shared<ClaimsRegistry>();
        let org = scenario.take_shared<Organization>();
        let clk = clock::create_for_testing(scenario.ctx());

        create_claim(&mut registry, &org, 30003692, b"Home Base", 100, &clk, scenario.ctx());
        assert!(has_claim(&registry, object::id(&org), 30003692));
        assert!(total_claims(&registry) == 1);

        clock::destroy_for_testing(clk);
        test_scenario::return_shared(org);
        test_scenario::return_shared(registry);
    };

    // Update name
    scenario.next_tx(creator);
    {
        let mut registry = scenario.take_shared<ClaimsRegistry>();
        let org = scenario.take_shared<Organization>();

        update_claim_name(&mut registry, &org, 30003692, b"Renamed Base", scenario.ctx());

        test_scenario::return_shared(org);
        test_scenario::return_shared(registry);
    };

    // Update weight
    scenario.next_tx(creator);
    {
        let mut registry = scenario.take_shared<ClaimsRegistry>();
        let org = scenario.take_shared<Organization>();

        update_claim_weight(&mut registry, &org, 30003692, 200, scenario.ctx());

        test_scenario::return_shared(org);
        test_scenario::return_shared(registry);
    };

    // Remove claim
    scenario.next_tx(creator);
    {
        let mut registry = scenario.take_shared<ClaimsRegistry>();
        let org = scenario.take_shared<Organization>();

        remove_claim(&mut registry, &org, 30003692, scenario.ctx());
        assert!(!has_claim(&registry, object::id(&org), 30003692));
        assert!(total_claims(&registry) == 0);

        test_scenario::return_shared(org);
        test_scenario::return_shared(registry);
    };

    scenario.end();
}

#[test]
#[expected_failure(abort_code = ENotStakeholder, location = Self)]
fun test_non_stakeholder_cannot_create_claim() {
    let creator = @0xCAFE;
    let intruder = @0xBAD;
    let mut scenario = test_scenario::begin(creator);

    {
        let registry = ClaimsRegistry {
            id: object::new(scenario.ctx()),
            total_claims: 0,
        };
        transfer::share_object(registry);
    };

    scenario.next_tx(creator);
    {
        let org = governance::org::create_org(b"Test Org", scenario.ctx());
        governance::org::share_for_testing(org);
    };

    // Intruder tries to create claim
    scenario.next_tx(intruder);
    {
        let mut registry = scenario.take_shared<ClaimsRegistry>();
        let org = scenario.take_shared<Organization>();
        let clk = clock::create_for_testing(scenario.ctx());

        create_claim(&mut registry, &org, 30000001, b"Stolen", 50, &clk, scenario.ctx());

        clock::destroy_for_testing(clk);
        test_scenario::return_shared(org);
        test_scenario::return_shared(registry);
    };

    scenario.end();
}
