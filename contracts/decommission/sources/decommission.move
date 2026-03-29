/// Decommission Registry -- On-chain registry for marking Market<T>
/// currencies as decommissioned. Visible to all Periscope instances.
///
/// Any address can decommission a market ID they claim to own.
/// Authorization is advisory -- the Periscope UI restricts the
/// decommission button to the market creator, but the contract
/// itself does not verify creator status (the Market module does
/// not expose a public creator accessor).
///
/// Only the original decommissioner can recommission.
module decommission::decommission {
    use sui::table::{Self, Table};
    use sui::event;

    // ── Error codes ────────────────────────────────────────────────────

    const ENotDecommissioner: u64 = 0;
    const EAlreadyDecommissioned: u64 = 1;
    const ENotDecommissioned: u64 = 2;

    // ── Types ──────────────────────────────────────────────────────────

    /// Shared registry mapping market object IDs to decommissioner addresses.
    public struct Registry has key {
        id: UID,
        entries: Table<address, address>,
    }

    // ── Events ─────────────────────────────────────────────────────────

    public struct DecommissionEvent has copy, drop {
        market_id: address,
        decommissioner: address,
    }

    public struct RecommissionEvent has copy, drop {
        market_id: address,
        recommissioner: address,
    }

    // ── Init ───────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        transfer::share_object(Registry {
            id: object::new(ctx),
            entries: table::new(ctx),
        });
    }

    // ── Entry functions ────────────────────────────────────────────────

    /// Mark a market as decommissioned. Records the sender as the
    /// decommissioner so only they can recommission later.
    public fun decommission(
        registry: &mut Registry,
        market_id: address,
        ctx: &TxContext,
    ) {
        assert!(
            !table::contains(&registry.entries, market_id),
            EAlreadyDecommissioned,
        );

        table::add(&mut registry.entries, market_id, ctx.sender());

        event::emit(DecommissionEvent {
            market_id,
            decommissioner: ctx.sender(),
        });
    }

    /// Recommission a previously decommissioned market.
    /// Only the original decommissioner can call this.
    public fun recommission(
        registry: &mut Registry,
        market_id: address,
        ctx: &TxContext,
    ) {
        assert!(
            table::contains(&registry.entries, market_id),
            ENotDecommissioned,
        );

        let decommissioner = table::remove(&mut registry.entries, market_id);
        assert!(decommissioner == ctx.sender(), ENotDecommissioner);

        event::emit(RecommissionEvent {
            market_id,
            recommissioner: ctx.sender(),
        });
    }
}
