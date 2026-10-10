/**
 * The confidential helpers pull in the zk-sdk WASM module, so they are loaded on demand: only
 * when a payment has actually been swept, or when the person moves payments to private.
 */
export const loadConfidential = () => import("@opaq/sdk/confidential");
