/** Parses a decimal string such as "12.5" into base units, or returns null if it is not a valid amount. */
export function parseUnits(input: string, decimals: number): bigint | null {
  const text = input.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1]! + fraction.padEnd(decimals, "0"));
}
