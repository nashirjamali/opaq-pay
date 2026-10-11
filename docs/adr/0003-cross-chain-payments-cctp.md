# ADR 0003: Cross-chain payments through Circle CCTP V2

Date: 2026-10-11. Status: proposed. SDK, relay policy and payer page are written; the live devnet
server and web app have not been redeployed with them.

## Context

Payers hold USDC on EVM chains. Opaq should accept it without a bridge of its own and without
touching the programs. An EVM payer has no Solana wallet, so somebody else must do every Solana
step of the payment, and that somebody must not be able to redirect the funds.

## Decision

1. Use CCTP V2. The payer burns USDC on the source chain (`depositForBurn`) with the stealth
   address's Solana USDC account as `mintRecipient`. After the mint the payment is an ordinary
   Opaq payment: scan, sweep, shield.
2. The relayer pays for the three Solana steps and signs only as fee payer and funder:
   - Before the burn, one transaction creates the stealth USDC account (CCTP cannot mint into a
     missing account) and announces the payment. The announcer is a throwaway key made in the
     payer's browser; the relayer never puts its name on an announcement. Announcing first means
     the recipient can find the one-time address whatever happens to the payer's browser
     afterwards, so burned USDC cannot end up at an address nobody knows.
   - After Circle attests the burn, the relayer delivers the message (`receive_message`). It is
     both `payer` and `caller` there: the attested message leaves no room in the transaction for
     a second signature. `caller` is a read-only signer that the program only compares with the
     message's `destinationCaller`, which the burn leaves open.
   - It never signs for the funds: the mint recipient is fixed in the attested message.
3. Relay policy (`apps/server/src/relayer.ts`): registry `announce` only, without the relayer
   among its accounts; CCTP `receive_message` only, relayer at `payer`/`caller` and nowhere in
   the accounts handed on, receiver pinned to Circle's token messenger. Cost caps, the daily
   budget and the rate limit apply as for every relayed transaction.
4. `@opaq/sdk` (`src/cctp.ts`) has no EVM dependency. It returns the contract address, ABI
   fragments and arguments; the app sends the two EVM transactions with its own library.
   `receive_message` is built by hand from Circle's published IDL and checked against a real
   devnet transaction in the unit tests.
5. Fast Transfer when Circle quotes it for the route; its fee comes out of the amount received.
6. Source chains sit behind the existing chain flag. Arc Testnet is enabled because it was run
   end to end (gas there is paid in USDC, so a test payer needs no other token). Base Sepolia is
   configured but stays `planned` until a run passes.

## Consequences

- No program change. The vault already holds Circle's devnet USDC.
- The burn, the mint and the announcement are public: the payer's EVM address, the amount and
  the stealth address are linked, as for a Solana payer. The recipient is not.
- The relayer learns the stealth address before the payment exists, so it can tie a payer
  session to a stealth address. It is trusted for privacy here, as in ADR 0002.
- An announcement can exist without money: the payer may leave before burning, or the delivery
  may still be in flight. Scanners see that as an existing, empty stealth USDC account with no
  wrapper account (`tokenAccountExists`), and the app does not list it until funds arrive. An
  abandoned payment costs the relayer the rent of that account (about 0.002 SOL), which only the
  recipient's stealth key could give back.
- A burn that was sent but not delivered is finished by the payer's browser (it keeps the burn
  transaction, which is public data) or by anyone else holding the attestation. If that browser
  never comes back, the USDC stays burned and unminted until someone delivers it; a server job
  that retries known burns is not built.
- The relayer does not check whose USDC a delivered message mints. Anyone can have it deliver
  any CCTP transfer to Solana, within its cost caps, and anyone can have it create token accounts
  and relay announcements. These are bounded costs, not a way to move its funds.
- The attestation API is untrusted. Solana verifies the attestation; the relayer still checks
  the decoded `mintRecipient` so it does not pay to deliver somebody else's message.
- Still to do: redeploy the devnet server and web app, click the payer page through with an EVM
  wallet, a server-side retry for undelivered burns, and a mainnet source table. Standard
  (non-fast) transfers from chains with slow finality take minutes.
