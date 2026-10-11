"use client";

import {
  CCTP_ERC20_ABI,
  getPayToMetaAddressInstructions,
  isValidHandleName,
  fetchMetaAddress,
  type CctpSourceChain,
  type ChainId,
  type VaultSettings,
} from "@opaq/sdk";
import type { Address } from "@solana/kit";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPublicClient, createWalletClient, custom, http, parseAbi } from "viem";
import { CbCircle, CbIcon } from "@/components/CbIcon";
import { Logo } from "@/components/Logo";
import { UsdcMark, UsdcOnSolana } from "@/components/TokenMarks";
import { EVM_SOURCES, NEXT_CHAINS, NEXT_CHAINS_LABEL } from "@/lib/chains";
import { evmChain } from "@/lib/evm/chain";
import { useEvmWallets, type EvmWallet } from "@/lib/evm/wallets";
import { getSolBalance, getVault, MIN_SOL_LAMPORTS, rpc, sendInstructions } from "@/lib/opaq/chain";
import {
  CROSS_CHAIN_PHASE_LABEL,
  finishCrossChainPayment,
  forgetPendingPayment,
  payFromEvm,
  recallPendingPayment,
  rememberPendingPayment,
  type CrossChainPhase,
  type CrossChainResult,
  type PendingCrossChainPayment,
} from "@/lib/opaq/crosschain";
import { config, WALLET_CHAIN } from "@/lib/opaq/env";
import { formatUsdc } from "@/lib/format";
import { parseUnits } from "@/lib/units";
import { explainError, lowSolMessage } from "@/lib/wallet/errors";
import { connectWallet, createWalletSigner, recallWalletName, reconnectWallet, rememberWallet } from "@/lib/wallet/standard";
import { useWallets } from "@/lib/wallet/useWallets";

type Meta = { scanPubkey: Uint8Array; spendPubkey: Uint8Array };
type Lookup =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; message: string }
  | { state: "ready"; meta: Meta; vault: VaultSettings };

interface Connected {
  wallet: Wallet;
  account: WalletAccount;
}

interface EvmConnected {
  wallet: EvmWallet;
  address: `0x${string}`;
}

/** What the payer sees once a payment is done, from either kind of chain. */
interface Paid {
  amount: string;
  /** Null for a payment made on Solana. */
  from: CctpSourceChain | null;
  /** The Solana transaction; null when a cross-chain delivery was made by someone else. */
  signature: string | null;
  burnTx?: string;
}

const erc20 = parseAbi(CCTP_ERC20_ABI);
const sourceOf = (chain: ChainId) => EVM_SOURCES.find((source) => source.chain === chain) ?? null;

export function PayView({ handle }: { handle: string }) {
  const params = useSearchParams();
  const note = params.get("note")?.slice(0, 80) ?? "";
  const [amount, setAmount] = useState(params.get("amount") ?? "");
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [from, setFrom] = useState<ChainId>("solana");
  const [connected, setConnected] = useState<Connected | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [evm, setEvm] = useState<EvmConnected | null>(null);
  const [evmUsdc, setEvmUsdc] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<"connecting" | "paying" | null>(null);
  const [phase, setPhase] = useState<CrossChainPhase | null>(null);
  const [pending, setPending] = useState<PendingCrossChainPayment | null>(null);
  const [error, setError] = useState("");
  const [paid, setPaid] = useState<Paid | null>(null);
  const wallets = useWallets();
  const evmWallets = useEvmWallets();
  const source = sourceOf(from);

  const load = useCallback(async () => {
    setLookup({ state: "loading" });
    if (!isValidHandleName(handle)) return setLookup({ state: "missing" });
    try {
      const [meta, vault] = await Promise.all([fetchMetaAddress(rpc, handle, config.programs), getVault()]);
      setLookup(meta ? { state: "ready", meta, vault } : { state: "missing" });
    } catch (e) {
      setLookup({ state: "error", message: explainError(e) });
    }
  }, [handle]);

  useEffect(() => {
    void load();
  }, [load]);

  // The payer's USDC balance, so "not enough USDC" can be said before asking the wallet to sign.
  const mint = lookup.state === "ready" ? lookup.vault.underlyingMint : null;
  useEffect(() => {
    if (!connected || !mint) return;
    let live = true;
    setUsdc(null);
    rpc
      .getTokenAccountsByOwner(connected.account.address as Address, { mint }, { encoding: "jsonParsed" })
      .send()
      .then(({ value }) => {
        if (!live) return;
        setUsdc(value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n));
      })
      .catch(() => live && setUsdc(0n));
    return () => {
      live = false;
    };
  }, [connected, mint]);

  // The same for a wallet on another chain.
  useEffect(() => {
    if (!evm || !source) return;
    let live = true;
    setEvmUsdc(null);
    createPublicClient({ chain: evmChain(source), transport: http() })
      .readContract({ address: source.usdc, abi: erc20, functionName: "balanceOf", args: [evm.address] })
      .then((balance) => live && setEvmUsdc(balance))
      .catch(() => live && setEvmUsdc(null));
    return () => {
      live = false;
    };
  }, [evm, source]);

  const decimals = lookup.state === "ready" ? lookup.vault.decimals : 6;
  const whole = (units: bigint) => formatUsdc(Number(units) / 10 ** decimals);

  const finished = useCallback(
    (result: CrossChainResult, chain: CctpSourceChain) => {
      forgetPendingPayment(handle);
      setPending(null);
      setPaid({ amount: whole(result.received), from: chain, signature: result.mintSignature, burnTx: result.burnTx });
    },
    // `whole` only depends on the vault's decimals, which do not change for a loaded page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handle, decimals],
  );

  /** Delivers a payment whose USDC already left the other chain. Needs no wallet. */
  const finish = useCallback(
    async (payment: PendingCrossChainPayment, vault: VaultSettings) => {
      const chain = sourceOf(payment.chain);
      if (!chain) return setError("This payment came from a chain this page can no longer deliver from. Contact support with the transaction below.");
      setError("");
      setBusy("paying");
      try {
        finished(await finishCrossChainPayment({ source: chain, vault, pending: payment, onProgress: setPhase }), chain);
      } catch (e) {
        setError(explainError(e));
      } finally {
        setBusy(null);
        setPhase(null);
      }
    },
    [finished],
  );

  // A payment left unfinished by a reload or a closed tab is picked up again, once.
  const resumed = useRef(false);
  useEffect(() => {
    if (lookup.state !== "ready" || resumed.current) return;
    resumed.current = true;
    const left = recallPendingPayment(handle);
    if (!left) return;
    setPending(left);
    void finish(left, lookup.vault);
  }, [lookup, handle, finish]);

  // Reconnect the wallet used last time without a prompt, so a reload does not undo the connection.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || connected) return;
    const name = recallWalletName();
    const wallet = name ? wallets.find((w) => w.name === name) : undefined;
    if (!wallet) return;
    restored.current = true;
    void reconnectWallet(wallet).then((account) => {
      if (account) setConnected((current) => current ?? { wallet, account });
    });
  }, [wallets, connected]);

  async function connect(wallet: Wallet) {
    setError("");
    setBusy("connecting");
    try {
      const account = await connectWallet(wallet);
      rememberWallet(wallet.name);
      setConnected({ wallet, account });
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  /** Asks the wallet to be on the source chain, adding the network when the wallet does not know it. */
  async function switchTo(wallet: EvmWallet, chain: CctpSourceChain) {
    const client = createWalletClient({ chain: evmChain(chain), transport: custom(wallet.provider) });
    try {
      await client.switchChain({ id: chain.evmChainId });
    } catch (e) {
      if (/reject|denied|4001/i.test(String((e as Error)?.message))) throw e;
      await client.addChain({ chain: evmChain(chain) });
    }
    return client;
  }

  async function connectEvm(wallet: EvmWallet) {
    if (!source) return;
    setError("");
    setBusy("connecting");
    try {
      const client = createWalletClient({ chain: evmChain(source), transport: custom(wallet.provider) });
      const [address] = await client.requestAddresses();
      if (!address) throw new Error("The wallet did not share an address.");
      await switchTo(wallet, source);
      setEvm({ wallet, address });
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  async function paySolana(units: bigint, vault: VaultSettings, meta: Meta) {
    if (!connected) return;
    if (usdc !== null && units > usdc) return setError(`This wallet has ${whole(usdc)} USDC, which is not enough.`);
    setBusy("paying");
    try {
      const lamports = await getSolBalance(connected.account.address as Address);
      if (lamports < MIN_SOL_LAMPORTS) {
        setError(lowSolMessage(lamports, config.cluster, "Paying"));
        return;
      }
      const payer = createWalletSigner(connected.wallet, connected.account, WALLET_CHAIN);
      const { instructions } = await getPayToMetaAddressInstructions({
        payer,
        meta,
        mint: vault.underlyingMint,
        decimals: vault.decimals,
        amount: units,
        tokenProgram: vault.underlyingTokenProgram,
        programs: config.programs,
      });
      const signature = await sendInstructions(instructions, payer);
      setPaid({ amount: whole(units), from: null, signature });
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(null);
    }
  }

  async function payEvm(units: bigint, vault: VaultSettings, meta: Meta, chain: CctpSourceChain) {
    if (!evm) return;
    if (evmUsdc !== null && units > evmUsdc) return setError(`This wallet has ${whole(evmUsdc)} USDC on ${chain.name}, which is not enough.`);
    setBusy("paying");
    try {
      await switchTo(evm.wallet, chain);
      const walletClient = createWalletClient({ account: evm.address, chain: evmChain(chain), transport: custom(evm.wallet.provider) });
      const publicClient = createPublicClient({ chain: evmChain(chain), transport: http() });
      const result = await payFromEvm({
        source: chain,
        handle,
        meta,
        vault,
        amount: units,
        walletClient,
        publicClient,
        onProgress: setPhase,
        onPending: (payment) => {
          rememberPendingPayment(payment);
          setPending(payment);
        },
      });
      finished(result, chain);
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(null);
      setPhase(null);
    }
  }

  function pay(e: FormEvent) {
    e.preventDefault();
    if (lookup.state !== "ready") return;
    const units = parseUnits(amount, lookup.vault.decimals);
    if (!units || units <= 0n) return setError("Enter an amount greater than 0, with up to 6 decimals.");
    setError("");
    if (source) void payEvm(units, lookup.vault, lookup.meta, source);
    else void paySolana(units, lookup.vault, lookup.meta);
  }

  const pendingSource = pending ? sourceOf(pending.chain) : null;

  return (
    <div className="pay-shell">
      <header className="top">
        <Logo />
      </header>
      <main className="pay-main">
        <section className="payer pay-card" aria-labelledby="pay-title" aria-busy={lookup.state === "loading"}>
          {lookup.state === "loading" && (
            <>
              <span className="ph" aria-hidden="true" style={{ width: "50%", height: 14 }} />
              <span className="sr" role="status">Looking up @{handle}</span>
              <span className="ph" aria-hidden="true" style={{ width: "70%", height: 36 }} />
            </>
          )}

          {lookup.state === "missing" && (
            <>
              <h1 id="pay-title">No one is registered as @{handle}</h1>
              <p className="muted">Check the spelling of the link, or ask the person you are paying to send it again. Nothing was charged.</p>
            </>
          )}

          {lookup.state === "error" && (
            <>
              <h1 id="pay-title">Couldn&apos;t look up @{handle}</h1>
              <p className="muted">{lookup.message}</p>
              <button type="button" className="btn btn-secondary" onClick={() => void load()}>Try again</button>
            </>
          )}

          {lookup.state === "ready" && paid && (
            <>
              <CbCircle name="deposited" size={56} />
              <h1 id="pay-title">Sent {paid.amount} USDC to @{handle}</h1>
              {paid.from ? (
                <p className="muted">
                  The USDC left {paid.from.name} and arrived on Solana. Your {paid.from.name} address and the amount are public on both
                  chains; @{handle} is not linked to your wallet.
                </p>
              ) : (
                <p className="muted">
                  The payment is confirmed on chain. Your address and the amount are public; @{handle} is not linked to your wallet.
                </p>
              )}
              {paid.from && paid.burnTx && (
                <p className="small">
                  <a href={`${paid.from.explorerUrl}/tx/${paid.burnTx}`} target="_blank" rel="noreferrer">See it on {paid.from.name}</a>
                </p>
              )}
              {paid.signature && <p className="mono sig">{paid.signature}</p>}
            </>
          )}

          {lookup.state === "ready" && !paid && pending && (
            <>
              <h1 id="pay-title" className="pay-title">Your payment to @{handle} is on its way</h1>
              <p className="muted">
                {whole(BigInt(pending.amount))} USDC left {pendingSource?.name ?? "the other chain"} and is being delivered on Solana.
                You do not need your wallet for this step.
              </p>
              {busy === "paying" && (
                <p role="status" aria-busy="true">
                  <span className="ph" aria-hidden="true" style={{ display: "block", height: 10, width: "55%", marginBottom: 10 }} />
                  {phase ? `${CROSS_CHAIN_PHASE_LABEL[phase]}.` : "Getting started."} Keep this tab open.
                </p>
              )}
              {pendingSource && (
                <p className="small">
                  <a href={`${pendingSource.explorerUrl}/tx/${pending.burnTx}`} target="_blank" rel="noreferrer">See it on {pendingSource.name}</a>
                </p>
              )}
              {error && (
                <>
                  <p className="err" role="alert">{error} Your payment is not lost: it can be delivered again from here.</p>
                  <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void finish(pending, lookup.vault)}>
                    Try again
                  </button>
                </>
              )}
            </>
          )}

          {lookup.state === "ready" && !paid && !pending && (
            <form className="pay-form" onSubmit={pay} noValidate>
              <h1 id="pay-title" className="pay-title">Pay @{handle}</h1>
              {note && <p className="payer-note">{note}</p>}
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="pay-amount">Amount (USDC)</label>
                <input
                  id="pay-amount"
                  className="input num"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={error && !(source ? evm : connected) ? undefined : error ? true : undefined}
                  aria-describedby="pay-err"
                />
              </div>
              <div className="seg" role="group" aria-label="Pay from" style={{ flexWrap: "wrap" }}>
                <button type="button" aria-pressed={from === "solana"} disabled={busy !== null} onClick={() => { setFrom("solana"); setError(""); }}>
                  <UsdcOnSolana />Solana USDC
                </button>
                {EVM_SOURCES.map((chain) => (
                  <button key={chain.chain} type="button" aria-pressed={from === chain.chain} disabled={busy !== null} onClick={() => { setFrom(chain.chain); setError(""); }}>
                    <UsdcMark size={22} />{chain.name} USDC
                  </button>
                ))}
                {NEXT_CHAINS.length > 0 && (
                  <button type="button" aria-pressed="false" disabled title={`Next: ${NEXT_CHAINS_LABEL}`}>More chains, soon</button>
                )}
              </div>

              {!source && !connected && (
                <div className="stack" style={{ gap: 10, width: "100%" }}>
                  {wallets.map((w) => (
                    <button key={w.name} type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => connect(w)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={w.icon} alt="" width={20} height={20} />
                      {busy === "connecting" ? "Waiting for wallet" : `Connect ${w.name}`}
                    </button>
                  ))}
                  {wallets.length === 0 && (
                    <p className="notice" role="status">
                      <CbIcon name="no-wallet" size={18} />
                      <span>
                        You need a Solana wallet to pay. Install <a href="https://phantom.app/download" target="_blank" rel="noreferrer">Phantom</a> or{" "}
                        <a href="https://solflare.com/download" target="_blank" rel="noreferrer">Solflare</a>, then reload.
                      </span>
                    </p>
                  )}
                </div>
              )}

              {!source && connected && (
                <>
                  <p className="muted small">
                    Paying from {connected.wallet.name}
                    {usdc !== null && <> · <span className="num">{whole(usdc)}</span> USDC available</>}
                  </p>
                  <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                    {busy === "paying" ? "Confirm in your wallet" : "Pay with wallet"}
                  </button>
                </>
              )}

              {source && !evm && (
                <div className="stack" style={{ gap: 10, width: "100%" }}>
                  {evmWallets.map((w) => (
                    <button key={w.id} type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => connectEvm(w)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {w.icon && <img src={w.icon} alt="" width={20} height={20} />}
                      {busy === "connecting" ? "Waiting for wallet" : `Connect ${w.name}`}
                    </button>
                  ))}
                  {evmWallets.length === 0 && (
                    <p className="notice" role="status">
                      <CbIcon name="no-wallet" size={18} />
                      <span>
                        You need a wallet that works on {source.name}, such as{" "}
                        <a href="https://metamask.io/download" target="_blank" rel="noreferrer">MetaMask</a>. Install one, then reload.
                      </span>
                    </p>
                  )}
                </div>
              )}

              {source && evm && (
                <>
                  <p className="muted small">
                    Paying from {evm.wallet.name} on {source.name}
                    {evmUsdc !== null && <> · <span className="num">{whole(evmUsdc)}</span> USDC available</>}
                  </p>
                  <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                    {busy === "paying" ? (phase ? CROSS_CHAIN_PHASE_LABEL[phase] : "Getting started") : `Pay from ${source.name}`}
                  </button>
                  <p className="muted small">
                    Your wallet asks you to approve the USDC, then to send it. After that it is delivered on Solana for you, usually within a minute.
                  </p>
                </>
              )}

              <p className="err" id="pay-err" role="alert">{error}</p>
              <p className="fine">
                <CbIcon name="info" size={14} />{" "}
                {source
                  ? `Your ${source.name} address and the amount you send are public on ${source.name} and on Solana. @${handle} is not linked to your wallet or balance.`
                  : `Your address and the amount you send are public. @${handle} is not linked to your wallet or balance.`}
              </p>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
