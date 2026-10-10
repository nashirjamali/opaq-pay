/* eslint-disable @next/next/no-img-element */
/** The mark by default; `full` adds the wordmark (sidebar). */
export function Logo({ full = false }: { full?: boolean }) {
  const kind = full ? "logo" : "mark";
  const cls = full ? "logo logo-full" : "logo";
  return (
    <>
      <img className={`${cls} logo-light`} src={`/brand/${kind}-light.svg`} alt="Opaq" />
      <img className={`${cls} logo-dark`} src={`/brand/${kind}-dark.svg`} alt="Opaq" />
    </>
  );
}
