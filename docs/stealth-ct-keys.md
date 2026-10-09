# Confidential keys for stealth accounts (v1)

Status: draft, needs external review before mainnet. Implementation:
`packages/sdk/src/confidential.ts` (`deriveStealthConfidentialKeySeeds`,
`deriveStealthConfidentialKeys`). See ADR 0001 for why balances live on stealth accounts.

## Goal

Each payment's wrapper tokens stay in a Token-2022 account owned by the payment's stealth
address, configured for Confidential Transfer. That account needs an ElGamal keypair and an
AES-128 (authenticated encryption) key. Requirements:

- The recipient can always re-derive them (no extra backup).
- A holder of the scan-only viewing key (`scanSeed` + spend public key, see
  `docs/stealth-address-spec.md`) can decrypt the balance, but cannot move funds.
- Keys differ per stealth address, and differ from every other key in the system.

Token-2022's standard derivation (`deriveConfidentialKeys`: the owner signs
`solana-conf-bal/v1`) would require the stealth spend key and so would not be readable with a
viewing key. This scheme replaces only that derivation step; the keys themselves are built by
the zk-sdk's own constructors.

## Derivation

Inputs: `scanSeed` (32 bytes), `A` = the stealth address as its 32 raw bytes.

```
salt = "opaq/stealth-ct/v1"
elgamalSeed = HKDF-SHA256(ikm = scanSeed, salt, info = "opaq/stealth-ct/v1/elgamal" ‖ A, L = 32)
aeSeed      = HKDF-SHA256(ikm = scanSeed, salt, info = "opaq/stealth-ct/v1/ae"      ‖ A, L = 32)
ElGamal keypair = zk-sdk ElGamalKeypair.fromSeed(elgamalSeed)
AES key         = zk-sdk AeKey.fromSeed(aeSeed)
```

## Authority split

Every Token-2022 confidential instruction (configure, deposit, apply, withdraw, empty) and the
account close also require the token-account owner's signature, which is the stealth key
(`b + h`). A viewing-key holder can therefore decrypt and could compute proofs, but cannot get any
instruction accepted. Leaking the viewing key reveals amounts, never spend authority.

## Test vector v1

```
scanSeed     = 0102…20 (bytes 1..32)
A            = 9KwtkCZG7gBoCCVhZ3TKCWbiFcvTDnK87xGthhFAsRWh
elgamalSeed  = a6490f14724c7bb04e1d3fd77b55f69b46ae71202462ba47b17c2e21cd5ea312
aeSeed       = bcdba273a2b043eacf5c342fb76cd4d76b8e9dac7f83967dab4aa180a1fd70fc
```

Computed independently with Python's `hmac` (RFC 5869); checked in
`packages/sdk/test/confidential.test.ts`.

## Known limitations

- Anyone with the viewing key sees every shielded balance; there is no per-payment disclosure yet.
- Keys are not the standard wallet-level CT keys, so generic wallets/CLIs will not show these
  balances; only the SDK (or a reimplementation of this spec) can.
- Changing the salt, labels or `fromSeed` behaviour changes every key: bump to v2 and keep v1
  for decrypting existing accounts.
