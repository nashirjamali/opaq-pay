/** Three layered translucent panels from the Coinbank card background, mirrored to sit behind the balance's right edge. */
export function HeroPattern({ className = "hero-pattern" }: { className?: string }) {
  const panel = (y0: number, xr: number, ye: number, fill: number) => (
    <path
      d={`M0 ${y0} L${xr - 14} ${ye - 8} Q${xr} ${ye} ${xr} ${ye + 14} L${xr} 340 L0 340 Z`}
      fill="#fff"
      fillOpacity={fill}
      stroke="#fff"
      strokeOpacity={0.24}
    />
  );
  return (
    <svg className={className} viewBox="0 0 340 340" fill="none" aria-hidden="true" focusable="false">
      <g transform="translate(340 0) scale(-1 1)">
        {panel(30, 328, 236, 0.06)}
        {panel(115, 258, 272, 0.09)}
        {panel(195, 190, 312, 0.14)}
      </g>
    </svg>
  );
}
