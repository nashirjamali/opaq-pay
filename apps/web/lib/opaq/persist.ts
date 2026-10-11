import { metaKeysFromSeeds, type MetaKeys } from "@opaq/sdk";

/**
 * Keeps a signed-in account across page reloads. The two key seeds go into sessionStorage, which is
 * scoped to this tab and cleared when it closes, never localStorage. A restored session is checked
 * against the keys registered on chain before the app relies on it (see `SessionProvider`).
 */
const SESSION_KEY = "opaq:session";

export interface SavedSession {
  address: string;
  handle: string;
  keys: MetaKeys;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex: unknown): Uint8Array | null {
  if (typeof hex !== "string" || hex.length !== 64 || !/^[0-9a-f]+$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
}

export function saveSession(session: SavedSession): void {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        address: session.address,
        handle: session.handle,
        scanSeed: toHex(session.keys.scanSeed),
        spendSeed: toHex(session.keys.spendSeed),
      }),
    );
  } catch {
    /* storage can be blocked; the person signs in again after a reload */
  }
}

export function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const scanSeed = fromHex(saved.scanSeed);
    const spendSeed = fromHex(saved.spendSeed);
    if (typeof saved.address !== "string" || typeof saved.handle !== "string" || !scanSeed || !spendSeed) return null;
    return { address: saved.address, handle: saved.handle, keys: metaKeysFromSeeds(scanSeed, spendSeed) };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing stored */
  }
}
