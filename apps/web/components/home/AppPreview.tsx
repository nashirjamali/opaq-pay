/**
 * Screenshots of the real demo Overview (signed out, sample data), not a redrawn copy, so the preview cannot drift from the app.
 * Regenerate them when the Overview changes: desktop at 1512x982, phone at 390x560, both themes. The demo banner is hidden and
 * the link box shows opaq.pay instead of localhost in the capture.
 */
const ALT = "The Opaq Pay Overview screen with sample data: private balance, payment link, recent activity and a weekly chart.";

export function AppPreview() {
  return (
    <div className="pv-shot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="d l" src="/home/preview/overview-light.png" width={1512} height={982} alt={ALT} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="d k" src="/home/preview/overview-dark.png" width={1512} height={982} alt={ALT} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="p l" src="/home/preview/phone-light.png" width={390} height={560} alt={ALT} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="p k" src="/home/preview/phone-dark.png" width={390} height={560} alt={ALT} />
    </div>
  );
}
