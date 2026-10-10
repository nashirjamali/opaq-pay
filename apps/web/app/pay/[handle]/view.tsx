"use client";

import { getPayToMetaAddressInstructions, isValidHandleName, fetchMetaAddress, type VaultSettings } from "@opaq/sdk";
import type { Address } from "@solana/kit";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CbCircle, CbIcon } from "@/components/CbIcon";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getSolBalance, getVault, MIN_SOL_LAMPORTS, rpc, sendInstructions } from "@/lib/opaq/chain";
import { config, WALLET_CHAIN } from "@/lib/opaq/env";
import { formatUsdc } from "@/lib/format";
import { parseUnits } from "@/lib/units";
import { explainError, lowSolMessage } from "@/lib/wallet/errors";
import { connectWallet, createWalletSigner } from "@/lib/wallet/standard";
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

export function PayView({ handle }: { handle: string }) {
  const params = useSearchParams();
  const note = params.get("note")?.slice(0, 80) ?? "";
  const [amount, setAmount] = useState(params.get("amount") ?? "");
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [connected, setConnected] = useState<Connected | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<"connecting" | "paying" | null>(null);
  const [error, setError] = useState("");
  const [paid, setPaid] = useState<{ signature: string; amount: string } | null>(null);
  const wallets = useWallets();

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

  async function connect(wallet: Wallet) {
    setError("");
    setBusy("connecting");
    try {
      setConnected({ wallet, account: await connectWallet(wallet) });
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(null);
    }
  }

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (lookup.state !== "ready" || !connected) return;
    const units = parseUnits(amount, lookup.vault.decimals);
    if (!units || units <= 0n) return setError("Enter an amount greater than 0, with up to 6 decimals.");
    if (usdc !== null && units > usdc) return setError(`This wallet has ${formatUsdc(Number(usdc) / 10 ** lookup.vault.decimals)} USDC, which is not enough.`);
    setError("");
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
        meta: lookup.meta,
        mint: lookup.vault.underlyingMint,
        decimals: lookup.vault.decimals,
        amount: units,
        tokenProgram: lookup.vault.underlyingTokenProgram,
        programs: config.programs,
      });
      const signature = await sendInstructions(instructions, payer);
      setPaid({ signature, amount: formatUsdc(Number(units) / 10 ** lookup.vault.decimals) });
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="pay-shell">
      <header className="top">
        <Logo />
        <span className="grow" />
        <ThemeToggle />
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
              <p className="muted">
                The payment is confirmed on chain. Your address and the amount are public; @{handle} is not linked to your wallet.
              </p>
              <p className="mono sig">{paid.signature}</p>
            </>
          )}

          {lookup.state === "ready" && !paid && (
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
                  aria-invalid={error && !connected ? undefined : error ? true : undefined}
                  aria-describedby="pay-err"
                />
              </div>
              <div className="seg" role="group" aria-label="Pay from">
                <button type="button" aria-pressed="true">Solana USDC</button>
                <button type="button" aria-pressed="false" disabled>More chains, soon</button>
              </div>

              {!connected ? (
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
              ) : (
                <>
                  <p className="muted small">
                    Paying from {connected.wallet.name}
                    {usdc !== null && <> · <span className="num">{formatUsdc(Number(usdc) / 10 ** lookup.vault.decimals)}</span> USDC available</>}
                  </p>
                  <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                    {busy === "paying" ? "Confirm in your wallet" : "Pay with wallet"}
                  </button>
                </>
              )}
              <p className="err" id="pay-err" role="alert">{error}</p>
              <p className="fine">
                <CbIcon name="info" size={14} /> Your address and the amount you send are public. @{handle} is not linked to your wallet or balance.
              </p>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
