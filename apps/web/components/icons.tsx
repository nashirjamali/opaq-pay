import type { ReactNode } from "react";

/*
 * Opaq icon set. Drawn on a 24px grid with heavy round-capped strokes and 45 degree diagonals,
 * the same language as the mark's dashes, so the set looks like it belongs to the logo
 * instead of a stock library. Each icon says what its label says:
 * ring of dashes = balance, arrow into a corner = money in, arrow out of a corner = money out,
 * parallel dashes = a stream of payments, page = report, sliders = settings.
 */
function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const IconOverview = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 10.5 10.5 6.5M13.5 6.5l4 4M17.5 13.5l-4 4M10.5 17.5l-4-4" />
  </Svg>
);
export const IconReceive = (p: P) => (
  <Svg {...p}>
    <path d="M17 7 7 17M7 9v8h8" />
  </Svg>
);
export const IconActivity = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 13.5l5-5M8.5 19 19 8.5M14.5 19.5l5-5" />
  </Svg>
);
export const IconCashOut = (p: P) => (
  <Svg {...p}>
    <path d="M7 17 17 7M9 7h8v8" />
  </Svg>
);
export const IconReports = (p: P) => (
  <Svg {...p}>
    <path d="M7 3.5h6.5l5 5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
    <path d="M9.5 16l3-3M12.5 17.5l2.5-2.5" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <path d="M5 8h2M12 8h7M5 16h7M17 16h2" />
    <circle cx="9.5" cy="8" r="2" />
    <circle cx="14.5" cy="16" r="2" />
  </Svg>
);
