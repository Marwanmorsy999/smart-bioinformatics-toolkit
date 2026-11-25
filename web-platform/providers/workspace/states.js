// DEPRECATED compatibility shim — M7.4.
// Authoritative transition map and stage derivation live in
// functions/api/workspace/_lib.js (STATE_TRANSITIONS / WORKSPACE_STATES).
// This file intentionally keeps NO second transition map.
//
// Exported for older callers: canTransition, assertTransition, isTerminal,
// runSummary and the RUN_STATES alias.

export {
  RUN_STATES,
  canTransition,
  assertTransition,
  isTerminal,
  runSummary
} from "../../functions/api/workspace/_lib.js";
