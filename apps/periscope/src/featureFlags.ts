// Master build-time switch for chain-contract-dependent features.
//
// Cycle 5 (Stillness) republished the world package and the World API host was down at
// cutover, so every chain-CONTRACT feature is already broken in prod. This interim build
// disables them cleanly (no polling, no errors) while the non-chain features (log analyzer,
// industry calculator, star map, blueprints, jump planner) keep working. Plan 28 re-publishes
// the contracts and flips this back on (set VITE_CHAIN_ENABLED=true or delete the .env files).
//
// Source: VITE_CHAIN_ENABLED build-time env var (see apps/periscope/.env.production).
//   unset   -> true  (normal, chain-enabled build)
//   "false" -> false (interim Cycle-5 build)
export const CHAIN_ENABLED: boolean = import.meta.env.VITE_CHAIN_ENABLED !== "false";
