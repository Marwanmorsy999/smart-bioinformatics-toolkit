// DEPRECATED compatibility shim — M7.4.
// The AUTHORITATIVE catalog is functions/api/workspace/catalog.js. There must
// be exactly one list of workflow ids and one availability statement; do not
// add workflow metadata here. New code should import the authoritative module.

import {
  getWorkflow as authoritativeGetWorkflow,
  listWorkflows
} from "../../functions/api/workspace/catalog.js";

export {
  CATALOG_VERSION,
  WORKFLOWS,
  WORKFLOW_IDS,
  isKnownWorkflow,
  listWorkflows
} from "../../functions/api/workspace/catalog.js";

/** @deprecated Use listWorkflows() from functions/api/workspace/catalog.js. */
export function publicCatalog() {
  return listWorkflows();
}

/** @deprecated Use getWorkflow() from functions/api/workspace/catalog.js. */
export function getWorkflow(id) {
  return authoritativeGetWorkflow(id);
}
