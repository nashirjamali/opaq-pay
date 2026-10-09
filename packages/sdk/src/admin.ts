/**
 * Vault administration: one-time initialisation (upgrade authority only) and the two-step
 * admin transfer. Not needed by payers or recipients.
 */
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from './builders.js';
import { LOCALNET_PROGRAMS, type OpaqPrograms } from './config.js';
import * as vault from './generated/vault/index.js';

export const BPF_LOADER_UPGRADEABLE_ADDRESS = 'BPFLoaderUpgradeab1e11111111111111111111111' as Address;

/** ProgramData account of an upgradeable program (holds its upgrade authority). */
export async function findProgramDataAddress(programAddress: Address): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE_ADDRESS,
    seeds: [getAddressEncoder().encode(programAddress)],
  });
  return address;
}

/**
 * `init_config`. `admin` must be the vault program's upgrade authority. The wrapper mint must
 * be Token-2022 with Confidential Transfer locked (no authority, auto-approve, no auditor),
 * the config PDA as mint authority, no freeze authority and zero supply.
 */
export async function getInitVaultInstruction(input: {
  admin: TransactionSigner;
  underlyingMint: Address;
  wrappedMint: Address;
  treasury: Address;
  feeBps: number;
  underlyingTokenProgram?: Address;
  programs?: OpaqPrograms;
}): Promise<Instruction> {
  const programAddress = (input.programs ?? LOCALNET_PROGRAMS).vault;
  const [config] = await vault.findConfigPda({ programAddress });
  const [vaultAccount] = await vault.findVaultPda({ config }, { programAddress });
  return vault.getInitConfigInstruction(
    {
      admin: input.admin,
      program: programAddress,
      programData: await findProgramDataAddress(programAddress),
      config,
      underlyingMint: input.underlyingMint,
      wrappedMint: input.wrappedMint,
      vault: vaultAccount,
      treasury: input.treasury,
      underlyingTokenProgram: input.underlyingTokenProgram ?? TOKEN_PROGRAM_ADDRESS,
      wrappedTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      feeBps: input.feeBps,
    },
    { programAddress },
  );
}

async function adminAccounts(programs: OpaqPrograms = LOCALNET_PROGRAMS) {
  const programAddress = programs.vault;
  const [config] = await vault.findConfigPda({ programAddress });
  const [pendingAdmin] = await vault.findPendingAdminPda({ config }, { programAddress });
  return { programAddress, config, pendingAdmin };
}

/** Step 1 of an admin change, signed by the current admin (who pays the pending account's rent). */
export async function getProposeAdminInstruction(input: {
  admin: TransactionSigner;
  newAdmin: Address;
  programs?: OpaqPrograms;
}): Promise<Instruction> {
  const { programAddress, config, pendingAdmin } = await adminAccounts(input.programs);
  return vault.getProposeAdminInstruction(
    { admin: input.admin, config, pendingAdmin, newAdmin: input.newAdmin },
    { programAddress },
  );
}

/** Step 2, signed by the proposed admin. `proposedBy` gets the pending account's rent back. */
export async function getAcceptAdminInstruction(input: {
  newAdmin: TransactionSigner;
  proposedBy: Address;
  programs?: OpaqPrograms;
}): Promise<Instruction> {
  const { programAddress, config, pendingAdmin } = await adminAccounts(input.programs);
  return vault.getAcceptAdminInstruction(
    { newAdmin: input.newAdmin, config, pendingAdmin, proposedBy: input.proposedBy },
    { programAddress },
  );
}

export async function getCancelAdminTransferInstruction(input: {
  admin: TransactionSigner;
  proposedBy: Address;
  programs?: OpaqPrograms;
}): Promise<Instruction> {
  const { programAddress, config, pendingAdmin } = await adminAccounts(input.programs);
  return vault.getCancelAdminTransferInstruction(
    { admin: input.admin, config, pendingAdmin, proposedBy: input.proposedBy },
    { programAddress },
  );
}
