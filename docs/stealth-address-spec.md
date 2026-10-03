# Stealth address scheme (v1)

Status: draft, needs external review before mainnet. Implementation:
`packages/sdk/src/stealth.ts`.

## Goal

A payer derives a fresh Solana address for every payment to a recipient, from the recipient's
public meta-address alone. Only the recipient can recognise the payment (with the scan key) and
spend from it (with the spend key). Observers cannot link the one-time address to the recipient's
handle or main wallet.

This is the dual-key stealth address construction (as in ERC-5564 / Monero) instantiated on
ed25519. It hides the recipient, not the payer or the amount sent to the stealth address.

## Notation

- `G`: ed25519 base point; `n`: group order.
- `scalar(seed)`: the clamped ed25519 secret scalar derived from a 32-byte seed (RFC 8032 §5.1.5),
  reduced mod `n`. `scalar(seed)·G` equals the standard ed25519 public key of `seed`.
- `H_s(x)`: `SHA-512(x)` read as a little-endian integer, reduced mod `n`; must be non-zero.
- `‖`: byte concatenation. Points are encoded as 32-byte compressed ed25519.

## Keys

The recipient holds two 32-byte seeds: `scanSeed` and `spendSeed`.

- `s = scalar(scanSeed)`, `S = s·G` (scan public key)
- `b = scalar(spendSeed)`, `B = b·G` (spend public key)

`(S, B)` is the meta-address, stored in `opaq_registry` under the recipient's handle.

## Payer: derive a payment

1. Decode `S` and `B`; reject identity, small-order or non-canonical points.
2. Pick a random 32-byte `ephemeralSeed`; `r = scalar(ephemeralSeed)`, `R = r·G`.
3. Shared point `Z = r·S`.
4. Tweak `h = H_s("opaq/stealth/v1/shared-secret" ‖ Z)`.
5. View tag `v = SHA-256("opaq/stealth/v1/view-tag" ‖ Z)[0]`.
6. Stealth public key `P = B + h·G`; the stealth address is `base58(P)`.
7. Pay to `P` and call `opaq_registry.announce(R, P, v)`.

## Recipient: scan

For each announcement `(R, P, v)`:

1. Decode `R`; skip the announcement if it is invalid (announcements are untrusted).
2. `Z = s·R` (equal to `r·S`).
3. Skip unless `SHA-256("opaq/stealth/v1/view-tag" ‖ Z)[0] == v`.
4. Compute `h` and `P' = B + h·G`; the payment is ours iff `P' == P`.

Scanning needs `s` and `B` only, so a merchant server can scan without spend authority.

## Recipient: spend

The private scalar for `P` is `p = (b + h) mod n`. Signatures are standard ed25519 (RFC 8032
verification) produced from the scalar directly:

- `prefix = SHA-512("opaq/stealth/v1/nonce-prefix" ‖ LE32(p))[0..32]`
- `k = H(prefix ‖ M) mod n`, `R_sig = k·G`
- `e = H(R_sig ‖ P ‖ M) mod n`, `S_sig = (k + e·p) mod n`
- signature `= R_sig ‖ LE32(S_sig)`

The prefix replaces RFC 8032's seed-derived prefix because `p` has no seed. Nonces stay
deterministic per (scalar, message).

## Test vector v1

Regression vector produced by the implementation (not an independent reference):

| Input | Value |
| --- | --- |
| scanSeed | `01` × 32 |
| spendSeed | `02` × 32 |
| ephemeralSeed | `03` × 32 |

| Output | Value |
| --- | --- |
| S (scanPubkey) | `8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c` |
| B (spendPubkey) | `8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394` |
| R (ephemeralPubkey) | `ed4928c628d1c2c6eae90338905995612959273a5c63f93636c14614ac8737d1` |
| stealth address | `5Yh3JG3jY5Aj5prsBL6hhzmYpHhjc4kaX1um7NDciGEG` |
| view tag | `148` |

`S` matches the well-known ed25519 public key of seed `01 × 32`, which checks the key
derivation independently.

## Known limitations

- The payer address and the amount sent to `P` are public, and so is the later sweep into
  `opaq_vault`. Timing can link payments.
- The view tag leaks 8 bits of `Z` and lets scanners skip ~255/256 of non-matching
  announcements; this is the same trade-off as ERC-5564.
- Changing any domain tag or step requires a new version tag (`v2`) and a new test vector.
