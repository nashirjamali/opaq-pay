"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BalanceFigure } from "@/components/BalanceFigure";
import { GlyphCheck, GlyphCopy, GlyphEye, GlyphEyeOff, GlyphLink, GlyphLock, GlyphOut, Icon } from "@/components/Icon";
import { ErrorBanner, LoadingRows } from "@/components/DataStates";
import { MarkArt } from "@/components/MarkArt";
import { PageHead } from "@/components/PageHead";
import { PaymentRow } from "@/components/PaymentRow";
import { WeekChart } from "@/components/WeekChart";
import { formatUsdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useCopy } from "@/lib/useCopy";
import { payLink, useOrigin } from "@/lib/useOrigin";

export function OverviewView() {
  const { balance, payments, handle, revealed, setRevealed, requireAccount, dataState } = useSession();
  const router = useRouter();
  const { copied, copy } = useCopy();
  const origin = useOrigin();
  const link = payLink(origin, handle);
  const loading = dataState === "loading";
  const failed = dataState === "error";
  const waiting = payments.filter((p) => p.status === "waiting").reduce((a, p) => a + p.amount, 0);
  const recent = payments.slice(0, 4);

  return (
    <>
      <PageHead title="Overview">Your private balance and what came in recently.</PageHead>
      <ErrorBanner />
      <div className="ov">
        {/* Single-hue gradient on the hero only: it lifts the balance, the one thing this screen is for. */}
        <section className="hero" aria-labelledby="bal">
          <MarkArt className="hero-art" />
          <div className="label">
            <span id="bal"><Icon as={GlyphLock} size={16} /> Private balance</span>
            <button type="button" className="hero-quiet" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>
              <Icon as={revealed ? GlyphEyeOff : GlyphEye} />
              {revealed ? "Hide amounts" : "Show amounts"}
            </button>
          </div>
          <div className="amount num" aria-busy={loading}>
            {loading ? <span className="ph hero-ph" role="img" aria-label="Loading balance" /> : failed ? <span className="muted-hero">Unavailable</span> : <BalanceFigure value={balance} />}
            <small>USDC</small>
          </div>
          <p className="hero-sub">
            {loading
              ? "Checking the network for your payments."
              : failed
                ? "Your balance will show once the network answers."
                : waiting > 0
              ? `${formatUsdc(waiting)} USDC arrived and is not in your private balance yet.`
              : payments.length
                ? "Everything you received is in your private balance."
                : "No payments yet. Your first one will appear here when it lands."}
          </p>
          <div className="actions">
            <button type="button" className="btn btn-light" onClick={() => requireAccount("cashout", () => router.push("/cashout"))}>
              Cash out
              <Icon as={GlyphOut} />
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => requireAccount("copy", () => copy(link.href))}>
              <Icon as={copied ? GlyphCheck : GlyphCopy} />
              {copied ? "Copied" : "Copy payment link"}
            </button>
          </div>
        </section>
        <section className="card" aria-labelledby="lnk">
          <h2 id="lnk" className="h-ic"><Icon as={GlyphLink} size={20} /> Your payment link</h2>
          <div className="linkbox mono">{link.label}</div>
          <p className="muted">Anyone with this link can pay you. They see your handle, never your wallet or balance.</p>
          <p style={{ marginTop: 12 }}><Link href="/receive">Ask for a specific amount</Link></p>
        </section>
      </div>

      <div className="ov2">
        <div>
          <div className="section-head">
            <h2>Recent activity</h2>
            {payments.length > 0 && <Link href="/activity">See all activity</Link>}
          </div>
          {loading ? (
            <LoadingRows />
          ) : failed ? null : recent.length ? (
            <ul className="list">
              {recent.map((p) => (
                <li key={p.id}>
                  <PaymentRow p={p} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="list empty">
              <MarkArt className="empty-art" />
              <h3>No payments yet</h3>
              <p>Send your payment link to whoever owes you. Their payment shows up here when it lands.</p>
              <button type="button" className="btn btn-primary" onClick={() => requireAccount("copy", () => copy(link.href))}>
                <Icon as={copied ? GlyphCheck : GlyphCopy} />
                {copied ? "Copied" : "Copy payment link"}
              </button>
            </div>
          )}
        </div>
        <div>
          <div className="section-head"><h2 className="sr">This week</h2></div>
          <WeekChart payments={payments} />
        </div>
      </div>
    </>
  );
}
