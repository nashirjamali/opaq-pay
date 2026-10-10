import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { AppPreview } from "@/components/home/AppPreview";
import { HeroArt } from "@/components/home/HeroArt";
import "./home.css";

export const metadata: Metadata = {
  title: { absolute: "Opaq Pay | Get paid in USDC without showing your wallet" },
  description: "Share a link. Each payment lands in a one-time address only you can find, so payers never see your wallet or your balance.",
};

const STEPS = [
  { icon: "/home/page/step-account.svg", title: "Create your handle", body: "Sign in with a Solana wallet. Opaq derives your private keys from one signature and registers your handle." },
  { icon: "/home/page/step-deposited.svg", title: "Share your link", body: "Anyone can pay it. Each payment goes to a fresh one-time address that only you can find." },
  { icon: "/home/page/step-privacy.svg", title: "Move it into your private balance", body: "The Opaq relayer pays the network fees. Afterwards the amount is hidden on chain." },
  { icon: "/home/page/step-withdraw.svg", title: "Cash out when you want", body: "Send USDC 1:1 to any address you choose. You see what becomes public before you confirm.", soon: true },
] as const;

const PUBLIC = [
  "Your handle and the wallet that registered it",
  "Who paid you and how much they sent",
  "Deposits into the vault and cash-out amounts",
  "When payments happen",
];
const PRIVATE = [
  "Which wallet is yours. Payments go to one-time addresses",
  "Your balance, shielded with confidential transfers",
  "Which payments belong to you, unless you share a viewing key",
  "Your spend key, which never leaves your device",
];

export default function HomePage() {
  return (
    <div className="hp">
      <a className="skip" href="#top">Skip to content</a>
      <header className="hp-nav">
        <div className="hp-nav-in">
          <Link href="/" aria-label="Opaq Pay home" className="hp-logo"><Logo full /></Link>
          <nav aria-label="Sections" className="hp-links">
            <a href="#how-it-works">How it works</a>
            <a href="#public">What is public</a>
            <a href="#next">What is next</a>
            <a href="#platforms">Platforms</a>
          </nav>
          <div className="hp-nav-end">
            <Link href="/overview" className="btn hp-btn-plain hp-hide-sm">Try the demo</Link>
            <Link href="/overview?signin=1" className="btn btn-secondary">Create account</Link>
          </div>
        </div>
      </header>

      <main id="top" tabIndex={-1}>
        <section className="hp-hero">
          <div className="hp-wrap hp-hero-in">
            <div className="hp-hero-copy">
              <p className="hp-eyebrow">Private payments on Solana</p>
              <h1>Get paid in USDC without showing your wallet</h1>
              <p className="hp-lead">
                Share a link. Each payment lands in a one-time address only you can find, so payers never see your wallet or your balance. An accountant can still get read-only access.
              </p>
              <div className="hp-cta">
                <Link href="/overview?signin=1" className="btn btn-primary">Create account</Link>
                <Link href="/overview" className="btn btn-secondary">Try the demo</Link>
              </div>
              <p className="hp-fine"><img className="for-light" src="/home/hero/icon-info.svg" alt="" /><img className="for-dark" src="/home/hero/icon-info-dark.svg" alt="" />The demo uses sample data. The payer&apos;s address and the amount they send are public; your wallet and balance are not.</p>
            </div>
            <HeroArt />
          </div>
        </section>

        <section className="hp-facts" aria-label="Guarantees">
          <div className="hp-wrap hp-facts-in">
            <div><b>1%</b><p>Maximum protocol fee, enforced on chain</p></div>
            <div><b>1:1</b><p>USDC held in the vault for every private dollar</p></div>
            <div><b>0</b><p>Keys held by Opaq. Your spend key stays with you</p></div>
          </div>
        </section>

        <section className="hp-sec" id="how-it-works" aria-labelledby="how-h">
          <div className="hp-wrap">
            <div className="hp-head">
              <p className="hp-eyebrow">How it works</p>
              <h2 id="how-h">From a link to your own wallet in four steps</h2>
            </div>
            <ol className="hp-steps">
              {STEPS.map((s) => (
                <li key={s.title}>
                  <span className="hp-step-ico"><img src={s.icon} alt="" /></span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  {"soon" in s && <span className="hp-tag">Coming soon</span>}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="hp-sec hp-product" aria-labelledby="app-h">
          <img className="hp-bg-lines" src="/home/page/product-lines.svg" alt="" />
          <img className="hp-bg-soft" src="/home/page/product-pattern.svg" alt="" />
          <div className="hp-wrap">
            <div className="hp-head">
              <p className="hp-eyebrow">The app</p>
              <h2 id="app-h">See what came in, and move it when you are ready</h2>
              <p>One screen for your private balance, your payment link and every payment, with amounts you can hide in one click.</p>
            </div>
            <AppPreview />
          </div>
        </section>

        <section className="hp-sec" id="public" aria-labelledby="pub-h">
          <div className="hp-wrap">
            <div className="hp-head">
              <p className="hp-eyebrow">Honest by design</p>
              <h2 id="pub-h">What anyone can see, and what stays yours</h2>
              <p>Private does not mean untraceable. Opaq is not a mixer: everything stays traceable to whoever holds your viewing key.</p>
            </div>
            <div className="hp-two">
              <div className="hp-card">
                <h3 className="hp-card-h"><span className="hp-chip"><span className="hp-chip-ico"><img className="for-light" src="/home/page/icon-eye.svg" alt="" /><img className="for-dark" src="/home/page/icon-eye-dark.svg" alt="" /></span></span>Public on chain</h3>
                <ul className="hp-checks">{PUBLIC.map((t) => <li key={t}><img className="for-light" src="/home/page/icon-success.svg" alt="" /><img className="for-dark" src="/home/page/icon-success-dark.svg" alt="" />{t}</li>)}</ul>
              </div>
              <div className="hp-card hp-card-dark">
                <div className="hp-wash">
                  <div className="wash-flip"><img className="wash-priv for-light" src="/home/page/pattern-private.svg" alt="" /><img className="wash-priv for-dark" src="/home/page/pattern-private-dark.svg" alt="" /></div>
                </div>
                <h3 className="hp-card-h"><span className="hp-chip"><img className="for-light" src="/home/page/icon-lock.svg" alt="" /><img className="for-dark" src="/home/page/icon-lock-dark.svg" alt="" /></span>Private to you</h3>
                <ul className="hp-checks">{PRIVATE.map((t) => <li key={t}><img className="for-light" src="/home/page/icon-success-lime.svg" alt="" /><img className="for-dark" src="/home/page/icon-success-lime-dark.svg" alt="" />{t}</li>)}</ul>
              </div>
            </div>
          </div>
        </section>

        <section className="hp-sec hp-next" id="next" aria-labelledby="next-h">
          <img className="hp-bg-lines" src="/home/page/bg-lines.svg" alt="" />
          <div className="hp-bg-diag" aria-hidden="true"><img src="/home/page/bg-pattern.svg" alt="" /></div>
          <div className="hp-wrap">
            <div className="hp-head">
              <p className="hp-eyebrow">What is next</p>
              <h2 id="next-h">Built to grow with how you get paid</h2>
              <p>Solana USDC works today on devnet. These are next, and they are not available yet.</p>
            </div>
            <div className="hp-two">
              <article className="hp-card hp-road">
                <div className="hp-road-art" aria-hidden="true">
                  <span className="hp-chain hp-chain-on"><b>Solana</b>Live on devnet</span>
                  <img src="/home/page/icon-arrow-right.svg" alt="" />
                  <span className="hp-chain hp-chain-off"><b>More chains</b>Next</span>
                </div>
                <div className="hp-road-body">
                  <h3>Pay from other chains <span className="hp-tag">Coming soon</span></h3>
                  <p>Payers on other chains will be able to send USDC through Circle CCTP. It lands in the same one-time address, and you do not change a thing.</p>
                </div>
              </article>
              <article className="hp-card hp-road">
                <div className="hp-road-art" aria-hidden="true">
                  <div className="hp-acct">
                    <div><span><img src="/home/page/icon-company.svg" alt="" />Accountant view</span><span className="hp-lime-tag">Read-only</span></div>
                    <div><span className="muted">Range</span><b>Oct 1 to Oct 31</b></div>
                    <div><span className="muted">Payments</span><b>Received and cashed out</b></div>
                  </div>
                </div>
                <div className="hp-road-body">
                  <h3>Reports your accountant can read <span className="hp-tag">Coming soon</span></h3>
                  <p>Share a date range with a viewing key. They can see what came in and cannot spend it. Export the same data as a CSV file.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="hp-sec" id="platforms" aria-labelledby="plat-h">
          <div className="hp-wrap hp-plat">
            <div>
              <p className="hp-eyebrow">For platforms</p>
              <h2 id="plat-h">Three ways in</h2>
              <p className="hp-lead">Use the app today, or build private payments into your own product. All three share the same one-time addresses and the same viewing keys.</p>
              <Link href="/overview" className="btn btn-primary">Try the demo</Link>
            </div>
            <ul className="hp-card hp-ways">
              <li><div><h3>Opaq Link</h3><p>A payment link and QR code for freelancers and creators.</p></div><span className="hp-tag hp-tag-dark">In the app today (devnet)</span></li>
              <li><div><h3>Opaq Checkout</h3><p>An embeddable checkout widget for online stores.</p></div><span className="hp-tag">Coming soon</span></li>
              <li><div><h3>Opaq SDK</h3><p>TypeScript SDK to take private payments inside your own product.</p></div><span className="hp-tag">In development</span></li>
            </ul>
          </div>
        </section>

        <div className="hp-wrap">
          <aside className="hp-slab hp-notice">
            <div className="hp-wash hp-wash-notice">
              <div className="wash-flip"><img className="wash-notice for-light" src="/home/page/pattern-notice.svg" alt="" /><img className="wash-notice for-dark" src="/home/page/pattern-notice-dark.svg" alt="" /></div>
            </div>
            <img className="for-light" src="/home/page/icon-info.svg" alt="" /><img className="for-dark" src="/home/page/icon-info-dark.svg" alt="" />
            <div>
              <h2>Opaq Pay runs on Solana devnet</h2>
              <p>Nothing here moves real funds yet. Try it, break it, tell us what you find.</p>
            </div>
          </aside>

          <section className="hp-final" aria-labelledby="cta-h">
            <div className="hp-wash hp-wash-cta">
              <div className="wash-flip"><img className="wash-cta for-light" src="/home/page/pattern-cta.svg" alt="" /><img className="wash-cta for-dark" src="/home/page/pattern-cta-dark.svg" alt="" /></div>
            </div>
            <div>
              <h2 id="cta-h">Create your payment link</h2>
              <p>Sign in with a Solana wallet, pick a handle, and share the link. It takes about a minute on devnet.</p>
              <Link href="/overview?signin=1" className="btn hp-btn-on">Create account</Link>
            </div>
            <div className="hp-pay" aria-hidden="true">
              <span className="muted">Pay @yourhandle</span>
              <b>Choose an amount</b>
              <div className="hp-seg"><span className="on">Solana USDC</span><span>More chains, soon</span></div>
              <span className="btn btn-primary">Pay with wallet</span>
            </div>
          </section>
        </div>
      </main>

      <footer className="hp-foot-outer">
        <div className="hp-wrap">
        <div className="hp-slab hp-foot">
          <div className="hp-wash hp-wash-foot">
            <div className="wash-flip"><img className="wash-cta for-light" src="/home/page/pattern-footer.svg" alt="" /><img className="wash-cta for-dark" src="/home/page/pattern-footer-dark.svg" alt="" /></div>
          </div>
          <div className="hp-foot-top">
            <div className="hp-foot-brand">
              <Logo full />
              <h2>Private payments on Solana.</h2>
              <p>Get paid in USDC without showing your wallet or balance to the people who pay you.</p>
              <div className="hp-cta">
                <Link href="/overview?signin=1" className="btn btn-primary btn-sm">Create account</Link>
                <Link href="/overview" className="btn hp-btn-on btn-sm">Try the demo</Link>
              </div>
            </div>
            <nav aria-label="Product" className="hp-col"><h3>Product</h3>
              <Link href="/overview">Overview demo</Link><Link href="/receive">Receive</Link><Link href="/activity">Activity</Link>
              <Link href="/cashout">Cash out (soon)</Link><Link href="/reports">Reports (soon)</Link>
            </nav>
            <nav aria-label="Developers" className="hp-col"><h3>Developers</h3>
              <Link href="/receive">Opaq Link</Link><span>Opaq Checkout (soon)</span><span>Opaq SDK (soon)</span>
            </nav>
            <nav aria-label="Learn" className="hp-col"><h3>Learn</h3>
              <a href="#how-it-works">How it works</a><a href="#public">What is public</a><a href="#next">What is next</a>
            </nav>
          </div>
          <div className="hp-foot-bot">
            <span>© 2026 Opaq Pay</span>
            <span className="hp-live"><img src="/home/page/devnet-dot.svg" alt="" />Running on Solana devnet</span>
            <span>Terms of Service</span>
            <span>Privacy Policy</span>
            <a href="#top" className="hp-top">Back to top <img className="for-light" src="/home/page/icon-arrow-up.svg" alt="" /><img className="for-dark" src="/home/page/icon-arrow-up-dark.svg" alt="" /></a>
          </div>
        </div>
        </div>
      </footer>
    </div>
  );
}
