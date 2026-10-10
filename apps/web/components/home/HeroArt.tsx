export function HeroArt() {
  return (
    <div className="art-frame" aria-hidden="true">
      <div className="art">
        <div className="art-pattern">
          <div className="art-flip">
            <img className="art-pattern-img for-light" src="/home/hero/pattern.svg" alt="" />
            <img className="art-pattern-img for-dark" src="/home/hero/pattern-dark.svg" alt="" />
          </div>
        </div>
        <img className="art-halo1 for-light" src="/home/hero/halo-1.svg" alt="" />
        <img className="art-halo1 for-dark" src="/home/hero/halo-1-dark.svg" alt="" />
        <img className="art-halo2 for-light" src="/home/hero/halo-2.svg" alt="" />
        <img className="art-halo2 for-dark" src="/home/hero/halo-2-dark.svg" alt="" />
        <img className="art-route for-light" src="/home/hero/route.svg" alt="" />
        <img className="art-route for-dark" src="/home/hero/route-dark.svg" alt="" />

        <div className="art-payer">
          <span className="art-tile"><img className="for-light" src="/home/hero/icon-wallet.svg" alt="" /><img className="for-dark" src="/home/hero/icon-wallet-dark.svg" alt="" /></span>
          <b>Payer</b>
          <span className="mono">9xQp…3tLw</span>
        </div>
        <span className="art-coin">$</span>
        <span className="art-pill">120.00 USDC</span>

        <div className="art-shield">
          <div className="art-shield-mask">
            <img className="for-light" src="/home/hero/shield.svg" alt="" />
            <img className="for-dark" src="/home/hero/shield-dark.svg" alt="" />
          </div>
        </div>
        <div className="art-once">
          <span>One-time address</span>
          <span className="mono">Fh3n…c2Ld</span>
        </div>

        <div className="art-balance">
          <div className="art-balance-pattern">
            <div className="art-flip">
              <img className="art-balance-img for-light" src="/home/hero/pattern-card.svg" alt="" />
              <img className="art-balance-img for-dark" src="/home/hero/pattern-card-dark.svg" alt="" />
            </div>
          </div>
          <span className="art-lock"><img className="for-light" src="/home/hero/icon-lock.svg" alt="" /><img className="for-dark" src="/home/hero/icon-lock-dark.svg" alt="" /></span>
          <span className="art-balance-label">Private balance</span>
          <span className="art-balance-amt"><b>2,480</b><small>.50</small></span>
        </div>

        <div className="art-note">
          <span className="art-note-badge"><img className="for-light" src="/home/hero/icon-eye-off.svg" alt="" /><img className="for-dark" src="/home/hero/icon-eye-off-dark.svg" alt="" /></span>
          <span className="art-note-copy">
            <b>Not linked to your wallet</b>
            <span>Observers see a payment, not you</span>
          </span>
        </div>
      </div>
    </div>
  );
}
