/** Turns wallet and RPC failures into one sentence a person can act on. */
export function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const text = message.toLowerCase();
  if (/reject|denied|declin|cancel|4001/.test(text)) return "You declined the request in your wallet. Nothing was sent.";
  if (/attempt to debit an account but found no record|insufficient lamports|insufficient funds for fee|0x1\b.*lamports/.test(text) ||
      /prior credit/.test(text)) {
    return "This wallet does not have enough SOL to pay the network fee. Add a little SOL and try again.";
  }
  if (/custom program error: 0x1\b|insufficient funds/.test(text)) return "This wallet does not have enough USDC for that amount.";
  if (/blockhash not found|expired/.test(text)) return "The transaction expired before it was confirmed. Try again.";
  if (/failed to fetch|networkerror|load failed/.test(text)) return "Could not reach the network. Check your connection and try again.";
  return `Something went wrong: ${message}`;
}
