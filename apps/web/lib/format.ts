/** Like `formatUsdc` but keeps up to six decimals, for amounts where rounding would mislead (fees). */
export function formatUsdcExact(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function formatUsdc(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
