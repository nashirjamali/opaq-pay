"use client";

import type { MetaKeys } from "@opaq/sdk";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateHandle } from "@/lib/handle";
import { checkHandle, deriveKeys, recallHandle, registerHandle, rememberHandle } from "@/lib/opaq/account";
import { WALLET_CHAIN } from "@/lib/opaq/env";
import { ACTION_LABEL, useSession } from "@/lib/session";
import { explainError } from "@/lib/wallet/errors";
import { connectWallet, createWalletSigner } from "@/lib/wallet/standard";
import { useWallets } from "@/lib/wallet/useWallets";
import { GlyphGoogle, GlyphKey, GlyphWallet, Icon } from "./Icon";

type Step = "choose" | "connecting" | "signing" | "handle" | "checking" | "registering";

interface Pending {
  wallet: Wallet;
  walletAccount: WalletAccount;
  keys: MetaKeys;
}

export function AuthDialog() {
  const { authOpen, authAction, authNonce, closeAuth, signIn } = useSession();
  const wallets = useWallets();
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<Step>("choose");
  const [error, setError] = useState("");
  const [walletName, setWalletName] = useState("your wallet");
  const [handleName, setHandleName] = useState("");
  const pending = useRef<Pending | null>(null);
  // Each open gets a run id; a wallet prompt answered after the dialog closed is ignored.
  const run = useRef(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (authOpen && !d.open) {
      run.current++;
      pending.current = null;
      setStep("choose");
      setError("");
      d.showModal();
    }
    if (!authOpen && d.open) d.close();
  }, [authOpen, authNonce]);

  function finish(p: Pending, handle: string) {
    rememberHandle(p.walletAccount.address, handle);
    signIn({ address: p.walletAccount.address, handle, keys: p.keys, wallet: p.wallet, walletAccount: p.walletAccount });
  }

  async function pick(wallet: Wallet) {
    const id = ++run.current;
    const live = () => id === run.current;
    setError("");
    setWalletName(wallet.name);
    try {
      setStep("connecting");
      const walletAccount = await connectWallet(wallet);
      if (!live()) return;
      setStep("signing");
      const keys = await deriveKeys(wallet, walletAccount);
      if (!live()) return;
      const next = { wallet, walletAccount, keys };
      pending.current = next;

      // A handle remembered for this wallet is only trusted if it still points at these keys.
      const remembered = recallHandle(walletAccount.address);
      if (remembered && (await checkHandle(remembered, keys)) === "mine") {
        if (live()) finish(next, remembered);
        return;
      }
      if (live()) setStep("handle");
    } catch (e) {
      if (!live()) return;
      setError(explainError(e));
      setStep("choose");
    }
  }

  async function submitHandle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = pending.current;
    if (!p) return;
    const name = handleName.trim().toLowerCase();
    const invalid = validateHandle(name);
    if (invalid) return setError(invalid);
    const id = run.current;
    const live = () => id === run.current;
    setError("");
    try {
      setStep("checking");
      const check = await checkHandle(name, p.keys);
      if (!live()) return;
      if (check === "taken") {
        setError("That handle is taken. Try another.");
        setStep("handle");
        return;
      }
      if (check === "available") {
        setStep("registering");
        await registerHandle(createWalletSigner(p.wallet, p.walletAccount, WALLET_CHAIN), name, p.keys);
        if (!live()) return;
      }
      finish(p, name);
    } catch (err) {
      if (!live()) return;
      setError(explainError(err));
      setStep("handle");
    }
  }

  const why = authAction ? `You need an account to ${ACTION_LABEL[authAction]}.` : "You need an account to receive payments.";
  const waiting = step === "connecting" || step === "signing" || step === "registering";

  return (
    <dialog ref={ref} aria-labelledby="auth-title" onClose={closeAuth} onClick={(e) => e.target === ref.current && closeAuth()}>
      {step === "choose" && (
        <div className="dlg">
          <h2 id="auth-title">Create your Opaq account</h2>
          <p>{why} The demo stays open without one.</p>
          <div className="stack" style={{ gap: 12 }}>
            {/* Google sign-in needs an embedded wallet provider, which is still an open decision. */}
            <button type="button" className="btn btn-secondary" disabled>
              <Icon as={GlyphGoogle} size={20} />
              Continue with Google
              <span className="soon-chip">Coming soon</span>
            </button>
            {wallets.map((w) => (
              <button key={w.name} type="button" className="btn btn-primary" onClick={() => pick(w)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.icon} alt="" width={20} height={20} />
                Use {w.name}
              </button>
            ))}
            {wallets.length === 0 && (
              <p className="notice" role="status">
                <Icon as={GlyphWallet} size={18} />
                <span>
                  No Solana wallet found in this browser. Install{" "}
                  <a href="https://phantom.app/download" target="_blank" rel="noreferrer">Phantom</a> or{" "}
                  <a href="https://solflare.com/download" target="_blank" rel="noreferrer">Solflare</a>, then reload this page.
                </span>
              </p>
            )}
          </div>
          {error && <p className="err" role="alert">{error}</p>}
          <p className="privacy">
            <Icon as={GlyphKey} size={16} /> Your spend key stays with you. Opaq cannot move your funds.
          </p>
          <button type="button" className="btn btn-quiet" onClick={closeAuth}>
            Not now
          </button>
        </div>
      )}

      {waiting && (
        <div className="dlg" aria-busy="true">
          <h2 id="auth-title">
            {step === "connecting" && `Connect ${walletName}`}
            {step === "signing" && "Create your private keys"}
            {step === "registering" && "Register your handle"}
          </h2>
          <span className="ph" aria-hidden="true" style={{ height: 10, width: "40%" }} />
          <p role="status">
            {step === "connecting" && `Approve the connection in ${walletName}.`}
            {step === "signing" &&
              `Sign the message in ${walletName}. It creates your private payment keys. It costs nothing and sends nothing to the network.`}
            {step === "registering" &&
              `Approve the transaction in ${walletName}. It records @${handleName.trim().toLowerCase()} and your wallet address on chain, and uses a small amount of SOL for rent and the network fee.`}
          </p>
          <button type="button" className="btn btn-quiet" onClick={closeAuth}>
            Cancel
          </button>
        </div>
      )}

      {(step === "handle" || step === "checking") && (
        <form className="dlg" onSubmit={submitHandle} noValidate>
          <h2 id="auth-title">Choose your handle</h2>
          <p className="muted">It becomes the end of your payment link.</p>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="handle">Handle</label>
            <div className="with-prefix">
              <span className="pre" aria-hidden="true">@</span>
              <input
                id="handle"
                className="input"
                value={handleName}
                onChange={(e) => setHandleName(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                disabled={step === "checking"}
                aria-invalid={error ? true : undefined}
                aria-describedby="handle-hint handle-err"
              />
            </div>
            <span className="hint" id="handle-hint">3 to 32 characters: a to z, 0 to 9 and underscore.</span>
            <span className="err" id="handle-err" role="alert">{error}</span>
          </div>
          <p className="notice">
            <Icon as={GlyphKey} size={18} />
            <span>
              Registering is public. The network records your handle together with the wallet that registered it. Payments
              sent to the handle are not linked back to either.
            </span>
          </p>
          <div className="row-btns">
            <button type="button" className="btn btn-secondary" onClick={closeAuth}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={step === "checking"}>
              {step === "checking" ? "Checking" : "Register handle"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
