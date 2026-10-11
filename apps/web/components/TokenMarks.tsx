/* eslint-disable @next/next/no-img-element */

/** Logos for the chain and the token, so money is not only a word. Official marks come from the design kit; chains without an asset yet fall back to text. */
export function SolanaMark({ size = 16 }: { size?: number }) {
  return <img className="mark" src="/brand/chains/solana.svg" width={size} height={size} alt="" />;
}

export function UsdcMark({ size = 16 }: { size?: number }) {
  return <img className="mark" src="/brand/chains/usdc.svg" width={size} height={size} alt="" />;
}

/** The "USDC" word with its logo in front. Decorative: the word carries the meaning. */
export function UsdcLabel({ size = 16 }: { size?: number }) {
  return (
    <span className="tok">
      <UsdcMark size={size} />
      USDC
    </span>
  );
}

/** USDC on Solana: the token logo with a small Solana badge, the way wallets show a token on a chain. */
export function UsdcOnSolana({ size = 22 }: { size?: number }) {
  const badge = Math.round(size * 0.5);
  return (
    <span className="tok-chain" style={{ width: size, height: size }} aria-hidden="true">
      <UsdcMark size={size} />
      <span className="tok-badge" style={{ width: badge, height: badge }}>
        <SolanaMark size={badge} />
      </span>
    </span>
  );
}
