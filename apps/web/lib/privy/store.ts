import type { Wallet } from "@wallet-standard/base";

/**
 * Privy is optional: without `NEXT_PUBLIC_PRIVY_APP_ID` the app is wallet-only and Google sign-in
 * stays "coming soon". The Privy hooks only work inside the provider, so `PrivyRoot` copies what
 * the rest of the app needs into this small store.
 */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || null;
export const privyEnabled = PRIVY_APP_ID !== null;

export interface PrivyState {
  /** Privy has finished loading and knows whether a session exists. */
  ready: boolean;
  /** Signed in with Google and the embedded wallet is available. */
  wallet: Wallet | null;
  /** The Google account's email, for the "Continue as" label. */
  label: string | null;
  login: () => void;
  logout: () => Promise<void>;
}

const idle: PrivyState = { ready: false, wallet: null, label: null, login: () => {}, logout: async () => {} };

let state = idle;
const listeners = new Set<() => void>();

export function setPrivyState(next: PrivyState): void {
  state = next;
  listeners.forEach((l) => l());
}

export const subscribePrivy = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const getPrivyState = () => state;
export const getServerPrivyState = () => idle;
