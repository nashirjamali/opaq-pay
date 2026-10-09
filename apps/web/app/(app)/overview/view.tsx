"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BalanceFigure } from "@/components/BalanceFigure";
import { GlyphCheck, GlyphCopy, GlyphEye, GlyphEyeOff, GlyphLink, GlyphLock, GlyphOut, Icon } from "@/components/Icon";
import { MarkArt } from "@/components/MarkArt";
import { PageHead } from "@/components/PageHead";
import { PaymentRow } from "@/components/PaymentRow";
import { WeekChart } from "@/components/WeekChart";
import { LINK_BASE } from "@/lib/config";
import { formatUsdc } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useCopy } from "@/lib/useCopy";

export function OverviewView() {
  const { balance, payments, handle, revealed, setRevealed, requireAccount } = useSession();
  const router = useRouter();
  const { copied, copy } = useCopy();
  const link = LINK_BASE + handle;
  const waiting = payments.filter((p) => p.status === "waiting").reduce((a, p) => a + p.amount, 0);
  const recent = payments.slice(0, 4);

  return (
    <>
      <PageHead title="Overview">Your private balance and what came in recently.</PageHead>
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
          <div className="amount num">
            <BalanceFigure value={balance} />
            <small>USDC</small>
          </div>
          <p className="hero-sub">
            {waiting > 0
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
            <button type="button" className="btn btn-ghost" onClick={() => requireAccount("copy", () => copy(link))}>
              <Icon as={copied ? GlyphCheck : GlyphCopy} />
              {copied ? "Copied" : "Copy payment link"}
            </button>
          </div>
        </section>
        <section className="card" aria-labelledby="lnk">
          <h2 id="lnk" className="h-ic"><Icon as={GlyphLink} size={20} /> Your payment link</h2>
          <div className="linkbox mono">{link}</div>
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
          {recent.length ? (
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
              <button type="button" className="btn btn-primary" onClick={() => requireAccount("copy", () => copy(link))}>
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
