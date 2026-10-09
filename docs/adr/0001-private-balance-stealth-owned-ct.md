# ADR 0001: Private balances with Token-2022 Confidential Transfer on stealth-owned accounts

Date: 2026-10-09. Status: accepted for the MVP.

## Context

Open decision: own Token-2022 CT wrapper vs. Umbra/Arcium. The vault already wraps USDC 1:1
into a Token-2022 mint with the Confidential Transfer extension. Umbra's anonymous transfers use
a shared pool (conflicts with "not a mixer"); Arcium C-SPL could not be confirmed as shipped.
The ZK ElGamal proof program was disabled in June 2025 and is enabled again on devnet and mainnet.

The first sweep design minted wrapper tokens to the recipient's wallet-owned account, which
publicly linked every payment's stealth address to the recipient's wallet and undid the stealth
layer. CT hides amounts, not counterparties, so it could not fix that.

## Decision

1. Use Token-2022 CT on our wrapper mint. No Umbra/Arcium for now.
2. Sweeps mint to the stealth address's own wrapper account (`getSweepToVaultInstructions`
   default). The stealth key signs everything after the payment; the relayer only pays.
3. Shielding is optional. Confidential keys per stealth account come from the scan seed
   (`docs/stealth-ct-keys.md`), so the viewing key can read balances.
4. Cash-out goes from the stealth account to an address the recipient chooses; the SDK and UI
   steer towards a fresh address. No consolidation into a recipient-owned account in the MVP.

Verified on Surfpool (`tests/full-flow.test.ts`) and devnet (`tests/scripts/smoke-devnet.ts`):
no transaction after the payment mentions the recipient's wallet or handle.

## Consequences

- Recipient identity stays unlinked from payments unless the recipient links it at cash-out.
- Amounts are public at payment, sweep and cash-out. Shielding a single-payment account hides
  little on its own; it matters once accounts receive or spend more than once.
- One wrapper account per payment. The relayer fronts its rent and gets it back on close; it
  also receives the stealth USDC account's rent (paid by the payer) at sweep.
- Roughly 10 transactions per payment lifecycle with shielding (unshield alone is 4), about
  0.0001 SOL in fees, peak 111k CU. The public devnet RPC rate-limits these plans.
- CT can be switched off by a feature gate again; the public path (sweep → withdraw) keeps working.
- Consolidation (one private account that pays out confidentially) is a later decision; it
  reveals which stealth accounts belong together.
