import { Logo } from "@/components/Logo";

const ROWS = [
  { who: "From 7xK2…9fQa", when: "Today, 14:02", chip: "wait", label: "Not yet private", amt: "+120.00", out: false },
  { who: "From Fh3n…c2Ld", when: "Today, 09:41", chip: "priv", label: "Private", amt: "+450.00", out: false },
  { who: "From Bq7r…m8Ye", when: "Yesterday, 17:20", chip: "priv", label: "Private", amt: "+75.50", out: false },
  { who: "Cash out", when: "4 days ago to 4tNb…Wq7e", chip: "out", label: "Cashed out", amt: "-280.00", out: true },
] as const;

const BARS = [
  { c: "hi", h: 81.481, t: 6.67, l: 6.14 },
  { c: "lo", h: 2.963, t: 85.19, l: 39.15 },
  { c: "hi", h: 65.977, t: 22.17, l: 72.17 },
  { c: "lo", h: 2.963, t: 85.19, l: 105.18 },
  { c: "lo", h: 2.963, t: 85.19, l: 138.2 },
  { c: "hi", h: 5.926, t: 82.22, l: 171.22 },
  { c: "today", h: 37.607, t: 50.54, l: 204.23 },
] as const;

const DAYS = ["6d", "5d", "4d", "3d", "2d", "1d", "Today"];

export function AppPreview() {
  return (
    <div className="pv" aria-hidden="true">
      <div className="pv-frame">
        <div className="pv-board">
          <aside className="pv-side">
            <div className="pv-brand"><Logo full /></div>
            <img className="pv-rule" src="/home/page/product-line.svg" alt="" />
            <nav className="pv-nav">
              <div className="pv-items">
                <span className="pv-item pv-on"><img src="/home/page/nav-dashboard.svg" alt="" />Overview</span>
                <span className="pv-item"><img src="/home/page/nav-receive.svg" alt="" />Receive</span>
                <span className="pv-item"><img src="/home/page/nav-activity.svg" alt="" />Activity</span>
                <span className="pv-item"><img src="/home/page/nav-cashout.svg" alt="" />Cash out</span>
                <span className="pv-item"><img src="/home/page/nav-reports.svg" alt="" />Reports</span>
              </div>
              <div className="pv-bottom">
                <div className="pv-note">
                  <b>What is public</b>
                  <span>Anyone can see who paid you and how much. They can&apos;t see which wallet is yours or what your balance is.</span>
                </div>
                <span className="pv-set"><img src="/home/page/nav-settings.svg" alt="" />Settings</span>
              </div>
            </nav>
          </aside>
          <div className="pv-main">
            <header className="pv-head">
              <b>Overview</b>
              <span className="pv-grow" />
              <span className="pv-pill"><img src="/home/page/solana.svg" alt="" />Solana Devnet</span>
              <span className="pv-moon"><img src="/home/page/icon-moon.svg" alt="" /></span>
              <span className="pv-addr">7xK2…9fQa</span>
              <span className="pv-acct"><i>Y</i>@yourhandle</span>
            </header>
            <div className="pv-body">
              <p className="pv-lead">Your private balance and what came in recently.</p>
              <div className="pv-hero-row">
                <section className="pv-bal">
                  <div className="pv-pat">
                    <div className="wash-flip"><img className="wash-bal" src="/home/page/pattern-balance.svg" alt="" /></div>
                  </div>
                  <div className="pv-bal-top">
                    <img src="/home/page/icon-lock-sm.svg" alt="" />
                    <span>Private balance</span>
                    <span className="pv-grow" />
                    <span className="pv-hide"><img src="/home/page/icon-eye-off.svg" alt="" />Hide amounts</span>
                  </div>
                  <div className="pv-amt">
                    <b>2,480</b>
                    <span>.50</span>
                    <span className="pv-usdc"><img src="/home/page/usdc.svg" alt="" />USDC</span>
                  </div>
                  <p>$120.00 USDC arrived and is not in your private balance yet.</p>
                  <div className="pv-acts">
                    <span className="pv-lime"><img src="/home/page/icon-lock-btn.svg" alt="" />Move to private balance</span>
                    <span><img src="/home/page/icon-arrow-up-sm.svg" alt="" />Cash out</span>
                    <span>Copy payment link</span>
                  </div>
                </section>
                <section className="pv-link">
                  <div className="pv-link-h"><span><img src="/home/page/icon-price.svg" alt="" /></span>Your payment link</div>
                  <div className="pv-linkbox">opaq.pay/pay/yourhandle</div>
                  <p>Anyone with this link can pay you. They see your handle, never your wallet or balance.</p>
                  <span className="pv-ask">Ask for a specific amount</span>
                </section>
              </div>
              <div className="pv-stats">
                <div>
                  <span><img src="/home/page/icon-lock-stat.svg" alt="" />PRIVATE PAYMENTS</span>
                  <b>4</b>
                </div>
                <div>
                  <span><img src="/home/page/icon-switch.svg" alt="" />WAITING TO MOVE</span>
                  <b>1</b>
                </div>
              </div>
              <div className="pv-low">
                <div className="pv-act">
                  <div className="pv-act-h"><b>Recent activity</b><span className="pv-grow" /><span>See all activity</span></div>
                  {ROWS.map((r) => (
                    <div className="pv-row" key={r.who}>
                      <span className={r.out ? "pv-tile pv-tile-out" : "pv-tile"}><img src={r.out ? "/home/page/icon-out.svg" : "/home/page/icon-in.svg"} alt="" /></span>
                      <span className="pv-who"><b>{r.who}</b><small>{r.when}</small></span>
                      <span className={`pv-chip pv-chip-${r.chip}`}>{r.label}</span>
                      <span className="pv-row-amt">{r.amt}</span>
                    </div>
                  ))}
                </div>
                <figure className="pv-chart">
                  <figcaption>Received in the last 7 days</figcaption>
                  <div className="pv-total"><b>1,880.50</b><span>USDC</span></div>
                  <div className="pv-plot">
                    <i className="g0" /><i className="g1" /><i className="g2" /><i className="g3" /><i className="g4" />
                    {BARS.map((b) => <span key={b.l} className={b.c} style={{ height: b.h, top: b.t, left: b.l }} />)}
                  </div>
                  <div className="pv-days">{DAYS.map((d) => <span key={d}>{d}</span>)}</div>
                </figure>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
