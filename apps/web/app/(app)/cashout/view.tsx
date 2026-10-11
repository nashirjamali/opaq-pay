"use client";

import { isAddress } from "@solana/kit";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CbCircle, CbIcon } from "@/components/CbIcon";
import { ErrorBanner } from "@/components/DataStates";
import { PageHead } from "@/components/PageHead";
import { UsdcLabel } from "@/components/TokenMarks";
import { formatUsdc, formatUsdcExact } from "@/lib/format";
import { CASH_OUT_PHASE_LABEL } from "@/lib/opaq/cashout";
import { useSession } from "@/lib/session";

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** Cash out everything held to one Solana address. Says what becomes public before anything is sent. */
export function CashOutView() {
  const { isDemo, address, balance, payments, dataState, cashOut, requireAccount } = useSession();
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState("");

  const waiting = payments.filter((p) => p.status === "waiting").reduce((a, p) => a + p.amount, 0);
  // The demo has no chain state behind it, so its numbers come from the sample data.
  const total = isDemo ? balance + waiting : cashOut.total;
  const unswept = isDemo ? waiting : cashOut.unswept;
  const feeBps = isDemo ? 50 : cashOut.feeBps;
  const fee = (unswept * feeBps) / 10_000;
  const net = total - fee;
  const loading = dataState === "loading";
  const { state } = cashOut;
  const value = recipient.trim();
  const toOwnWallet = address !== null && value === address;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isAddress(value)) {
      setError("Enter a Solana wallet address.");
      return;
    }
    setError("");
    requireAccount("cashout", () => cashOut.start(value));
  }

  const head = <PageHead title="Cash out">Send the USDC you hold to a Solana address you choose.</PageHead>;

  if (state.status === "running") {
    const progress = state.progress;
    return (
      <>
        {head}
        <section className="card stack" style={{ maxWidth: 560 }} aria-busy="true" aria-labelledby="co-run">
          <h2 id="co-run">Cashing out</h2>
          <span className="ph" aria-hidden="true" style={{ height: 10, width: "55%" }} />
          <p role="status">
            {progress ? `Payment ${progress.current} of ${progress.total}: ${CASH_OUT_PHASE_LABEL[progress.phase]}.` : "Getting started."}
          </p>
          <p className="muted small">
            Taking an amount out of the private balance takes some computing, so this can take a few minutes. Keep this tab open.
          </p>
        </section>
      </>
    );
  }

  if (state.status === "done") {
    return (
      <>
        {head}
        <section className="card stack" style={{ maxWidth: 560 }} aria-labelledby="co-done">
          <CbCircle name="withdraw" size={56} />
          <h2 id="co-done">{formatUsdcExact(state.amount)} USDC sent</h2>
          <p className="muted">
            It went to <span className="mono addr-inline">{short(state.recipient)}</span>. It can take a moment to show in the wallet.
          </p>
          <div className="row-btns">
            <Link className="btn btn-secondary" href="/activity">See activity</Link>
            <button type="button" className="btn btn-primary" onClick={cashOut.reset}>Done</button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {head}
      <ErrorBanner />
      {state.status === "error" && (
        <p className="notice" role="alert" style={{ maxWidth: 720, marginBottom: 20 }}>
          <CbIcon name="info" size={18} />
          <span>
            <strong>Couldn&apos;t finish cashing out.</strong> {state.message} Nothing was lost: what was not sent is still yours, and
            trying again picks up where it stopped.
          </span>
        </p>
      )}

      {!isDemo && !cashOut.available ? (
        <div className="empty">
          <CbCircle name="withdraw" size={64} />
          <h3>Cash out is not available right now</h3>
          <p>It needs the Opaq relayer, which this site is not connected to. Your balance stays where it is.</p>
        </div>
      ) : loading ? (
        <section className="card" style={{ maxWidth: 720 }} aria-busy="true">
          <span className="sr">Loading your balance</span>
          <span className="ph" aria-hidden="true" style={{ height: 14, width: "45%" }} />
        </section>
      ) : dataState === "error" ? null : total <= 0 ? (
        <div className="empty">
          <CbCircle name="withdraw" size={64} />
          <h3>Nothing to cash out</h3>
          <p>When a payment reaches you, you can send it on from here.</p>
          <Link className="btn btn-primary" href="/receive">Get your payment link</Link>
        </div>
      ) : (
        <form className="card stack" style={{ maxWidth: 720 }} onSubmit={submit} noValidate>
          <dl className="kv">
            <dt>In your private balance</dt>
            <dd className="num">{formatUsdcExact(total - unswept)} <UsdcLabel size={16} /></dd>
            {unswept > 0 && (
              <>
                <dt>Arrived, not yet in the vault</dt>
                <dd className="num">{formatUsdcExact(unswept)} <UsdcLabel size={16} /></dd>
                <dt>Protocol fee ({feeBps / 100}% of that part)</dt>
                <dd className="num">{formatUsdcExact(fee)} <UsdcLabel size={16} /></dd>
              </>
            )}
            <dt>You will receive</dt>
            <dd className="num">{formatUsdcExact(net)} <UsdcLabel size={16} /></dd>
          </dl>

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="recipient">Send to (Solana address)</label>
            <input
              id="recipient"
              className="input mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="Wallet address"
              value={recipient}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "recipient-err" : "recipient-hint"}
              onChange={(e) => {
                setRecipient(e.target.value);
                setError("");
              }}
            />
            {error ? (
              <span id="recipient-err" className="err" role="alert">{error}</span>
            ) : (
              <span id="recipient-hint" className="hint">A wallet address, not a token account.</span>
            )}
            {address && value !== address && (
              <button type="button" className="btn btn-quiet" style={{ justifySelf: "start" }} onClick={() => { setRecipient(address); setError(""); }}>
                Use my wallet {short(address)}
              </button>
            )}
          </div>

          <p className="notice">
            <CbIcon name="eye" size={18} />
            <span>
              {toOwnWallet ? (
                <>
                  <strong>This links these payments to your wallet.</strong> Anyone can then see that the one-time addresses
                  you were paid at belong to {short(value)}, and how much each one held. A new address that you control keeps
                  them apart from your wallet.
                </>
              ) : (
                <>
                  <strong>A cash out is public.</strong> Anyone can see the amount, the address it goes to, and that the
                  one-time addresses you were paid at all paid into it. Sending to your own wallet links them to that wallet.
                </>
              )}
            </span>
          </p>

          <p className="muted small">
            This sends everything you hold; choosing a part of it is not available yet. Your wallet is not asked to sign, and the
            Opaq relayer pays the network fees.
          </p>
          <div className="row-btns">
            <button type="submit" className="btn btn-primary">
              Cash out {formatUsdc(net)} USDC
            </button>
          </div>
        </form>
      )}
    </>
  );
}
