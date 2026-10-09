"use client";

import type { MetaKeys } from "@opaq/sdk";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadPayments } from "./opaq/payments";
import { explainError } from "./wallet/errors";
import { SAMPLE_BALANCE, SAMPLE_HANDLE, SAMPLE_PAYMENTS, type Payment } from "./sample";

export type ActionKey = "copy" | "cashout" | "report" | "csv" | "create";

export const ACTION_LABEL: Record<ActionKey, string> = {
  copy: "copy your payment link",
  cashout: "cash out",
  report: "create view access",
  csv: "export your payments",
  create: "get your own payment link",
};

/** Everything a signed-in person is: a wallet, a handle on chain, and keys held in memory only. */
export interface Account {
  address: string;
  handle: string;
  keys: MetaKeys;
  wallet: Wallet;
  walletAccount: WalletAccount;
}

export type DataState = "ready" | "loading" | "error";

interface Session {
  isDemo: boolean;
  handle: string;
  balance: number;
  payments: Payment[];
  /** Always "ready" in the demo. For an account: loading the first scan, or the last scan failed. */
  dataState: DataState;
  dataError: string;
  refresh: () => void;
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
  signIn: (account: Account) => void;
  signOut: () => void;
  account: Account | null;
}

const Ctx = createContext<Session | null>(null);
const POLL_MS = 20_000;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [revealed, setRevealed] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [authAction, setAuthAction] = useState<ActionKey | null>(null);
  const [authNonce, setAuthNonce] = useState(0);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [balance, setBalance] = useState(0);
  const [dataState, setDataState] = useState<DataState>("ready");
  const [dataError, setDataError] = useState("");
  const isDemo = account === null;

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

  const signIn = useCallback((next: Account) => {
    setAccount(next);
    setPayments([]);
    setBalance(0);
    setDataState("loading");
    setRevealed(false);
    setAuthOpen(false);
  }, []);

  const signOut = useCallback(() => {
    setAccount(null);
    setRevealed(true);
    setDataState("ready");
  }, []);

  // Scan for payments on sign-in, then every POLL_MS while the tab is visible. A late answer for a
  // previous account (or a previous request) is dropped.
  const requestId = useRef(0);
  const refresh = useCallback(() => {
    if (!account) return;
    const id = ++requestId.current;
    loadPayments(account.keys)
      .then((result) => {
        if (id !== requestId.current) return;
        setPayments(result.payments);
        setBalance(result.balance);
        setDataError("");
        setDataState("ready");
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return;
        setDataError(explainError(error));
        setDataState("error");
      });
  }, [account]);

  useEffect(() => {
    if (!account) return;
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      requestId.current++;
    };
  }, [account, refresh]);

  const retry = useCallback(() => {
    setDataState("loading");
    refresh();
  }, [refresh]);

  const value = useMemo<Session>(
    () => ({
      isDemo,
      handle: account?.handle ?? SAMPLE_HANDLE,
      balance: isDemo ? SAMPLE_BALANCE : balance,
      payments: isDemo ? SAMPLE_PAYMENTS : payments,
      dataState: isDemo ? "ready" : dataState,
      dataError,
      refresh: retry,
      revealed,
      setRevealed,
      authOpen,
      authAction,
      authNonce,
      openAuth,
      closeAuth,
      requireAccount,
      signIn,
      signOut,
      account,
    }),
    [isDemo, account, balance, payments, dataState, dataError, retry, revealed, authOpen, authAction, authNonce, openAuth, closeAuth, requireAccount, signIn, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}
