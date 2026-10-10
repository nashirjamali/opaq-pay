/** Turns wallet and RPC failures into one sentence a person can act on. */
/** Kit wraps the interesting failure (a relayer rejection, a program error) in `cause`, so read the whole chain. */
function messageChain(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error, depth = 0; e && depth < 6; depth++) {
    parts.push(e instanceof Error ? e.message : String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  // Prefer the deepest message when it says more than the wrapper.
  return parts.reverse().join(" | ");
}

export function explainError(error: unknown): string {
  const message = messageChain(error);
  const text = message.toLowerCase();
  if (/\b(429|503)\b|rate limit|too many/.test(text)) return "The relayer is busy right now. Wait a moment and try again.";
  if (/relayer rejected/.test(text)) return "The relayer could not accept this transaction. Try again, and if it keeps happening, contact support.";
  if (/user rejected|rejected the request|denied|declin|cancel|4001/.test(text)) return "You declined the request in your wallet. Nothing was sent.";
  if (/attempt to debit an account but found no record|insufficient lamports|insufficient funds for fee|0x1\b.*lamports/.test(text) ||
      /prior credit/.test(text)) {
    return "This wallet does not have enough SOL to pay the network fee. Add a little SOL and try again.";
  }
  if (/custom program error: 0x1\b|insufficient funds/.test(text)) return "This wallet does not have enough USDC for that amount.";
  if (/blockhash not found|expired/.test(text)) return "The transaction expired before it was confirmed. Try again.";
  if (/failed to fetch|networkerror|load failed/.test(text)) return "Could not reach the network. Check your connection and try again.";
  return `Something went wrong: ${message}`;
}
