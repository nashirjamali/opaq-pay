import { Surfnet } from '@solana/surfpool';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  getCreateAssociatedTokenIdempotentInstruction,
  findAssociatedTokenPda,
  getInitializeMint2Instruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  extension,
  getInitializeMint2Instruction as getInitializeMint2Instruction2022,
  getMintSize,
  getPreInitializeInstructionsForMintExtensions,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  createTransactionPlanExecutor,
  createTransactionPlanner,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Encoder,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type InstructionPlan,
  type KeyPairSigner,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';
import { fileURLToPath } from 'node:url';
import { decodeAnnouncementEventCpi, findProgramDataAddress, registry, vault, type Announcement } from '@opaq/sdk';

const deployDir = fileURLToPath(new URL('../target/deploy/', import.meta.url));

export type TestNet = Awaited<ReturnType<typeof startTestNet>>;

/** Offline surfnet with both Opaq programs deployed from `target/deploy` (run `anchor build` first). */
export async function startTestNet() {
  const surfnet = Surfnet.start();
  surfnet.deploy({ programId: registry.OPAQ_REGISTRY_PROGRAM_ADDRESS, soPath: `${deployDir}opaq_registry.so` });
  surfnet.deploy({ programId: vault.OPAQ_VAULT_PROGRAM_ADDRESS, soPath: `${deployDir}opaq_vault.so` });

  const rpc = createSolanaRpc(surfnet.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(surfnet.wsUrl);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  const admin = await createKeyPairSignerFromBytes(surfnet.payerSecretKey);

  // `surfnet.deploy` leaves no upgrade authority; make the admin the vault's, as on a real
  // deployment, so it may call `init_config`.
  {
    const programData = await findProgramDataAddress(vault.OPAQ_VAULT_PROGRAM_ADDRESS);
    const { value } = await rpc.getAccountInfo(programData, { encoding: 'base64' }).send();
    if (!value) throw new Error('vault ProgramData missing');
    const data = new Uint8Array(Buffer.from(value.data[0], 'base64'));
    // UpgradeableLoaderState::ProgramData: u32 tag, u64 slot, Option<Pubkey> (u8 tag + 32 bytes).
    data[12] = 1;
    data.set(getAddressEncoder().encode(admin.address), 13);
    surfnet.setAccount(programData, Number(value.lamports), data, value.owner);
  }

  async function send(instructions: Instruction[], feePayer: TransactionSigner): Promise<Signature> {
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const transaction = await signTransactionMessageWithSigners(message);
    assertIsTransactionWithBlockhashLifetime(transaction);
    await sendAndConfirm(transaction, { commitment: 'confirmed' });
    return getSignatureFromTransaction(transaction);
  }

  /** Sends a multi-transaction instruction plan (e.g. confidential-transfer proofs) in order. */
  async function sendPlan(plan: InstructionPlan, feePayer: TransactionSigner): Promise<Signature[]> {
    const signatures: Signature[] = [];
    const planner = createTransactionPlanner({
      createTransactionMessage: async () => {
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
        return pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(feePayer, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        );
      },
    });
    const executor = createTransactionPlanExecutor({
      executeTransactionMessage: async (_context, message) => {
        const transaction = await signTransactionMessageWithSigners(message);
        assertIsTransactionWithBlockhashLifetime(transaction);
        await sendAndConfirm(transaction, { commitment: 'confirmed' });
        const signature = getSignatureFromTransaction(transaction);
        signatures.push(signature);
        return { signature };
      },
    });
    await executor(await planner(plan));
    return signatures;
  }

  /** Every account a confirmed transaction touched. */
  async function accountsIn(signature: Signature): Promise<string[]> {
    const transaction = await rpc
      .getTransaction(signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
      .send();
    if (!transaction) throw new Error(`Transaction ${signature} not found`);
    return [
      ...transaction.transaction.message.accountKeys,
      ...(transaction.meta?.loadedAddresses?.writable ?? []),
      ...(transaction.meta?.loadedAddresses?.readonly ?? []),
    ];
  }

  async function fundedSigner(lamports = 2_000_000_000): Promise<KeyPairSigner> {
    const signer = await generateKeyPairSigner();
    surfnet.fundSol(signer.address, lamports);
    return signer;
  }

  async function tokenBalance(account: Address): Promise<bigint> {
    const { value } = await rpc.getTokenAccountBalance(account).send();
    return BigInt(value.amount);
  }

  async function accountExists(account: Address): Promise<boolean> {
    const { value } = await rpc.getAccountInfo(account, { encoding: 'base64' }).send();
    return value !== null;
  }

  async function createAccount(newAccount: KeyPairSigner, space: number, owner: Address): Promise<Instruction> {
    const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
    return getCreateAccountInstruction({ payer: admin, newAccount, lamports, space, programAddress: owner });
  }

  /** Classic SPL mint standing in for USDC (the surfnet is offline). */
  async function createUsdcMint(): Promise<Address> {
    const mint = await generateKeyPairSigner();
    await send(
      [
        await createAccount(mint, 82, TOKEN_PROGRAM_ADDRESS),
        getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: admin.address }),
      ],
      admin,
    );
    return mint.address;
  }

  /** Token-2022 wrapper mint with locked Confidential Transfer, no freeze authority. */
  async function createWrappedMint(mintAuthority: Address): Promise<Address> {
    const mint = await generateKeyPairSigner();
    // Locked confidential settings, as `init_config` requires: no authority, no auditor.
    const confidential = extension('ConfidentialTransferMint', {
      authority: null,
      autoApproveNewAccounts: true,
      auditorElgamalPubkey: null,
    });
    await send(
      [
        await createAccount(mint, getMintSize([confidential]), TOKEN_2022_PROGRAM_ADDRESS),
        ...getPreInitializeInstructionsForMintExtensions(mint.address, [confidential]),
        getInitializeMint2Instruction2022({ mint: mint.address, decimals: 6, mintAuthority, freezeAuthority: null }),
      ],
      admin,
    );
    return mint.address;
  }

  async function createAta(owner: Address, mint: Address, tokenProgram: Address = TOKEN_PROGRAM_ADDRESS) {
    const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
    await send([getCreateAssociatedTokenIdempotentInstruction({ payer: admin, ata, owner, mint, tokenProgram })], admin);
    return ata;
  }

  async function mintUsdc(mint: Address, owner: Address, amount: bigint): Promise<Address> {
    const ata = await createAta(owner, mint);
    await send([getMintToInstruction({ mint, token: ata, mintAuthority: admin, amount })], admin);
    return ata;
  }

  /** Announcements emitted by `opaq_registry` in a confirmed transaction. */
  async function announcementsIn(signature: Signature): Promise<Announcement[]> {
    const transaction = await rpc
      .getTransaction(signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
      .send();
    if (!transaction) throw new Error(`Transaction ${signature} not found`);
    const keys = [
      ...transaction.transaction.message.accountKeys,
      ...(transaction.meta?.loadedAddresses?.writable ?? []),
      ...(transaction.meta?.loadedAddresses?.readonly ?? []),
    ];
    const found: Announcement[] = [];
    for (const inner of transaction.meta?.innerInstructions ?? []) {
      for (const ix of inner.instructions) {
        if (keys[ix.programIdIndex] !== registry.OPAQ_REGISTRY_PROGRAM_ADDRESS) continue;
        const decoded = decodeAnnouncementEventCpi(new Uint8Array(getBase58Encoder().encode(ix.data)));
        if (decoded) found.push(decoded);
      }
    }
    return found;
  }

  return {
    surfnet,
    rpc,
    admin,
    send,
    sendPlan,
    accountsIn,
    fundedSigner,
    tokenBalance,
    accountExists,
    createUsdcMint,
    createWrappedMint,
    createAta,
    mintUsdc,
    announcementsIn,
    stop: () => surfnet.stop(),
  };
}
