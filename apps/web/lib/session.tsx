"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { SAMPLE_BALANCE, SAMPLE_HANDLE, SAMPLE_PAYMENTS, type Payment } from "./sample";

export type ActionKey = "copy" | "cashout" | "report" | "csv" | "create";

export const ACTION_LABEL: Record<ActionKey, string> = {
  copy: "copy your payment link",
  cashout: "cash out",
  report: "create view access",
  csv: "export your payments",
  create: "get your own payment link",
};

interface Session {
  isDemo: boolean;
  handle: string;
  balance: number;
  payments: Payment[];
  revealed: boolean;
  setRevealed: (v: boolean) => void;
  authOpen: boolean;
  authAction: ActionKey | null;
  /** Bumps on every open request so the dialog reopens even if `authOpen` never flipped back. */
  authNonce: number;
  openAuth: (action?: ActionKey) => void;
  closeAuth: () => void;
  /** Runs `fn` for an account holder; in the demo it opens Create account instead. */
  requireAccount: (action: ActionKey, fn: () => void) => void;
  /** TODO: replace with the embedded-wallet provider and an `opaq_registry` register_handle call. */
  createAccount: (handle: string) => Promise<{ error?: string }>;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [isDemo, setIsDemo] = useState(true);
  const [handle, setHandle] = useState(SAMPLE_HANDLE);
  const [revealed, setRevealed] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [authAction, setAuthAction] = useState<ActionKey | null>(null);
  const [authNonce, setAuthNonce] = useState(0);

  const openAuth = useCallback((action?: ActionKey) => {
    setAuthAction(action ?? "create");
    setAuthNonce((n) => n + 1);
    setAuthOpen(true);
  }, []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);

  const requireAccount = useCallback(
    (action: ActionKey, fn: () => void) => {
      if (isDemo) openAuth(action);
      else fn();
    },
    [isDemo, openAuth],
  );

  const createAccount = useCallback(async (next: string) => {
    if (["demo", "admin", "opaq", "test"].includes(next)) return { error: "That handle is taken. Try another." };
    setHandle(next);
    setIsDemo(false);
    setRevealed(false);
    setAuthOpen(false);
    return {};
  }, []);

  const signOut = useCallback(() => {
    setIsDemo(true);
    setHandle(SAMPLE_HANDLE);
    setRevealed(true);
  }, []);

  const value = useMemo<Session>(
    () => ({
      isDemo,
      handle,
      balance: isDemo ? SAMPLE_BALANCE : 0,
      payments: isDemo ? SAMPLE_PAYMENTS : [],
      revealed,
      setRevealed,
      authOpen,
      authAction,
      authNonce,
      openAuth,
      closeAuth,
      requireAccount,
      createAccount,
      signOut,
    }),
    [isDemo, handle, revealed, authOpen, authAction, authNonce, openAuth, closeAuth, requireAccount, createAccount, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}
