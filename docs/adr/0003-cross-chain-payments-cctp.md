# ADR 0003: Cross-chain payments through Circle CCTP V2

Date: 2026-10-11. Status: proposed (SDK and proof script only; server and web not done).

## Context

Payers hold USDC on EVM chains. Opaq should accept it without a bridge of its own and without
touching the programs. An EVM payer has no Solana wallet, so somebody else must do every Solana
step of the payment, and that somebody must not be able to redirect the funds.

## Decision

1. Use CCTP V2. The payer burns USDC on the source chain (`depositForBurn`) with the stealth
   address's Solana USDC account as `mintRecipient`. After the mint the payment is an ordinary
   Opaq payment: scan, sweep, shield.
2. The relayer does the three Solana steps: create the stealth USDC account before the burn (CCTP
   cannot mint into a missing account), deliver the attested message (`receive_message`), and
   announce. It never signs for the funds: the mint recipient is fixed in the attested message.
3. `@opaq/sdk` (`src/cctp.ts`) has no EVM dependency. It returns the contract address, ABI
   fragments and arguments; the app sends the two EVM transactions with its own library.
   `receive_message` is built by hand from Circle's published IDL and checked against a real
   devnet transaction in the unit tests.
4. Fast Transfer when Circle quotes it for the route; its fee comes out of the amount received.
5. Source chains sit behind the existing chain flag. Arc Testnet is enabled because it was run
   end to end (gas there is paid in USDC, so a test payer needs no other token). Base Sepolia is
   configured but stays `planned` until a run passes.

## Consequences

- No program change. The vault already holds Circle's devnet USDC.
- The burn, the mint and the announcement are public: the payer's EVM address, the amount and
  the stealth address are linked, as for a Solana payer. The recipient is not.
- The relayer learns the stealth address before the payment exists and announces it, so it can
  tie a payer session to a stealth address. It is trusted for privacy here, as in ADR 0002.
- The announcement is a second transaction after the mint. If it never lands, the funds sit at
  an address the recipient cannot find; the relayer must retry, and the ephemeral key has to be
  kept until then.
- The attestation API is untrusted. Solana verifies the attestation; the relayer still checks
  the decoded `mintRecipient` so it does not pay to deliver somebody else's message.
- Still to do: relay policy for `receive_message` and relayer-signed `announce` (with negative
  tests), a server endpoint that waits for attestations, the payer page, and a mainnet source
  table. Standard (non-fast) transfers from chains with slow finality take minutes.
