"use client";

import { useState } from "react";
import { CbIcon } from "@/components/CbIcon";
import { Logo } from "@/components/Logo";
import { PageHead } from "@/components/PageHead";
import { QrCode } from "@/components/QrCode";
import { useSession } from "@/lib/session";
import { useCopy } from "@/lib/useCopy";
import { payLink, useOrigin } from "@/lib/useOrigin";

export function ReceiveView() {
  const { handle, requireAccount } = useSession();
  const { copied, copy } = useCopy();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const query = new URLSearchParams();
  if (amount.trim()) query.set("amount", amount.trim());
  if (note.trim()) query.set("note", note.trim());
  const qs = query.toString();
  const origin = useOrigin();
  const base = payLink(origin, handle);
  const url = base.href + (qs ? `?${qs}` : "");
  const shown = base.label + (qs ? `?${qs}` : "");

  return (
    <>
      <PageHead title="Receive">Share one link. Each payment goes to a fresh address that only you can find.</PageHead>
      <div className="two">
        <div className="stack">
          <section className="card" aria-labelledby="your-link">
            <h2 id="your-link" className="h-ic"><span className="ic-chip"><CbIcon name="price" /></span> Your link</h2>
            <div className="link-qr">
              <div>
                <div className="linkbox mono">{shown}</div>
                <button type="button" className="btn btn-primary" onClick={() => requireAccount("copy", () => copy(url))}>
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              {origin && <QrCode value={url} />}
            </div>
          </section>
          <section className="card" aria-labelledby="ask">
            <h2 id="ask" className="h-ic" style={{ marginBottom: 14 }}><span className="ic-chip"><CbIcon name="coins" /></span> Ask for a specific amount</h2>
            <div className="field">
              <label htmlFor="amount">Amount (USDC)</label>
              <input id="amount" className="input num" inputMode="decimal" placeholder="Leave empty to let the payer choose" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="note">What it&apos;s for</label>
              <input id="note" className="input" maxLength={80} placeholder="Invoice, order, tip" value={note} onChange={(e) => setNote(e.target.value)} />
              <span className="hint">The payer sees this on the payment page.</span>
            </div>
          </section>
        </div>

        <section className="preview" aria-labelledby="payer-view">
          <h2 id="payer-view" className="preview-tag">What your payer sees</h2>
          <div className="payer" inert>
            <Logo />
            <p className="muted">Pay @{handle}</p>
            <p className="payer-amount num">{amount.trim() ? `${amount.trim()} USDC` : "Choose an amount"}</p>
            {note.trim() && <p className="payer-note">{note.trim()}</p>}
            <div className="seg" role="group" aria-label="Pay from">
              <button type="button" aria-pressed="true" tabIndex={-1}>Solana USDC</button>
              <button type="button" aria-pressed="false" disabled tabIndex={-1}>More chains, soon</button>
            </div>
            <button type="button" className="btn btn-primary" tabIndex={-1}>Pay with wallet</button>
            <p className="fine">Your address and the amount you send are public. @{handle} is not linked to your wallet or balance.</p>
          </div>
        </section>
      </div>
    </>
  );
}
