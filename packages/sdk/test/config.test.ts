import { describe, expect, it } from 'vitest';
import {
  assertChainEnabled,
  configFromEnv,
  createConfig,
  DEVNET_PROGRAMS,
  LOCALNET_PROGRAMS,
  OpaqConfigError,
  parseEnabledChains,
} from '../src/index.js';

describe('program IDs', () => {
  it('knows the devnet deployment', () => {
    expect(DEVNET_PROGRAMS.vault).toBe('JHC14FJWJWAkLNj4aDe1EPr65ideg4tSoZmrdXuZtPA');
    expect(DEVNET_PROGRAMS.registry).toBe('6xaXX6KSFxkNohbanstr2Sqpk3teRUExuLQ1u1ndcEyE');
  });

  it('defaults to devnet and lets env override either program', () => {
    expect(configFromEnv({}).programs).toEqual(DEVNET_PROGRAMS);
    expect(configFromEnv({ OPAQ_CLUSTER: 'localnet' }).programs).toEqual(LOCALNET_PROGRAMS);
    const custom = configFromEnv({ OPAQ_VAULT_PROGRAM_ID: LOCALNET_PROGRAMS.vault });
    expect(custom.programs).toEqual({ registry: DEVNET_PROGRAMS.registry, vault: LOCALNET_PROGRAMS.vault });
  });

  it('rejects bad cluster names and bad addresses', () => {
    expect(() => configFromEnv({ OPAQ_CLUSTER: 'mainnet-beta' })).toThrow(OpaqConfigError);
    expect(() => configFromEnv({ OPAQ_VAULT_PROGRAM_ID: 'nope' })).toThrow(OpaqConfigError);
  });
});

describe('chain feature flag', () => {
  it('is Solana only by default', () => {
    expect(parseEnabledChains(undefined)).toEqual(['solana']);
    expect(parseEnabledChains('  ')).toEqual(['solana']);
    expect(configFromEnv({}).enabledChains).toEqual(['solana']);
  });

  it('accepts a list with spaces, case and duplicates', () => {
    expect(parseEnabledChains(' Solana , solana ')).toEqual(['solana']);
  });

  it('rejects unknown and not-yet-available chains', () => {
    expect(() => parseEnabledChains('solana,doge')).toThrow(/Unknown chain/);
    expect(() => parseEnabledChains('solana,base')).toThrow(/not available yet/);
    expect(() => parseEnabledChains('__proto__')).toThrow(/Unknown chain/);
  });

  it('keeps Solana enabled and guards chain use', () => {
    expect(() => parseEnabledChains('base')).toThrow();
    const config = createConfig({ cluster: 'localnet' });
    expect(() => assertChainEnabled(config, 'solana')).not.toThrow();
    expect(() => assertChainEnabled(config, 'base')).toThrow(OpaqConfigError);
  });
});
