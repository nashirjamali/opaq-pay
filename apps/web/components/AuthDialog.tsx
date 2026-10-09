"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateHandle } from "@/lib/handle";
import { GlyphGoogle, GlyphKey, GlyphWallet, Icon } from "./Icon";
import { ACTION_LABEL, useSession } from "@/lib/session";

export function AuthDialog() {
  const { authOpen, authAction, authNonce, closeAuth, createAccount } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"choose" | "handle">("choose");
  const [error, setError] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (authOpen && !d.open) {
      setStep("choose");
      setError("");
      d.showModal();
    }
    if (!authOpen && d.open) d.close();
  }, [authOpen, authNonce]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("handle") ?? "").trim();
    const invalid = validateHandle(value);
    if (invalid) return setError(invalid);
    const res = await createAccount(value);
    if (res.error) setError(res.error);
  }

  const why = authAction ? `You need an account to ${ACTION_LABEL[authAction]}.` : "You need an account to receive payments.";

  return (
    <dialog ref={ref} aria-labelledby="auth-title" onClose={closeAuth} onClick={(e) => e.target === ref.current && closeAuth()}>
      {step === "choose" ? (
        <div className="dlg">
          <h2 id="auth-title">Create your Opaq account</h2>
          <p>{why} The demo stays open without one.</p>
          <div className="stack" style={{ gap: 12 }}>
            {/* TODO: wire to the embedded wallet provider (open decision). */}
            <button type="button" className="btn btn-primary" onClick={() => setStep("handle")}>
              <Icon as={GlyphGoogle} size={20} />
              Continue with Google
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setStep("handle")}>
              <Icon as={GlyphWallet} size={20} />
              Use a Phantom or Solflare wallet
            </button>
          </div>
          <p className="privacy">
            <Icon as={GlyphKey} size={16} /> Your spend key stays with you. Opaq cannot move your funds.
          </p>
          <button type="button" className="btn btn-quiet" onClick={closeAuth}>
            Not now
          </button>
        </div>
      ) : (
        <form className="dlg" onSubmit={onSubmit} noValidate>
          <h2 id="auth-title">Choose your handle</h2>
          <p className="muted">It becomes the end of your payment link.</p>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="handle">Handle</label>
            <div className="with-prefix">
              <span className="pre" aria-hidden="true">@</span>
              <input
                id="handle"
                name="handle"
                className="input"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                aria-invalid={error ? true : undefined}
                aria-describedby="handle-hint handle-err"
              />
            </div>
            <span className="hint" id="handle-hint">3 to 32 characters: a to z, 0 to 9 and underscore. Your handle is public.</span>
            <span className="err" id="handle-err" role="alert">{error}</span>
          </div>
          <div className="row-btns">
            <button type="button" className="btn btn-secondary" onClick={closeAuth}>Cancel</button>
            <button type="submit" className="btn btn-primary">Register handle</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
