"use client";

import { useEffect, useRef } from "react";
import { formatUsdc, formatUsdcExact } from "@/lib/format";
import { MOVE_PHASE_LABEL } from "@/lib/opaq/shield";
import { useSession } from "@/lib/session";
import { CbCircle, CbIcon } from "./CbIcon";

/** Confirms, runs and reports moving payments into the private balance. */
export function MoveDialog() {
  const { move } = useSession();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (move.open && !d.open) d.showModal();
    if (!move.open && d.open) d.close();
  }, [move.open]);

  const { state } = move;
  const running = state.status === "running";
  const fee = (move.unswept * move.feeBps) / 10_000;
  const net = move.total - fee;
  const feePct = `${move.feeBps / 100}%`;
  const progress = state.status === "running" ? state.progress : null;

  return (
    <dialog
      ref={ref}
      aria-labelledby="move-title"
      // A move in flight cannot be cancelled, so the dialog stays until it settles.
      onCancel={(e) => running && e.preventDefault()}
      onClose={move.closeDialog}
      onClick={(e) => e.target === ref.current && !running && move.closeDialog()}
    >
      {state.status === "idle" && (
        <div className="dlg">
          <CbCircle name="privacy" size={56} />
          <h2 id="move-title">Move {formatUsdc(move.total)} USDC to your private balance</h2>
          <dl className="kv">
            <dt>Protocol fee ({feePct})</dt>
            <dd className="num">{move.unswept > 0 ? `${formatUsdcExact(fee)} USDC` : "none, already in the vault"}</dd>
            <dt>You will have</dt>
            <dd className="num">{formatUsdcExact(net)} USDC</dd>
          </dl>
          <p className="notice">
            <CbIcon name="lock" size={18} />
            <span>
              Afterwards the amount is hidden on chain. The deposit into the vault stays public, and the payment is still
              not linked to your wallet.
            </span>
          </p>
          <p className="muted small">
            Nothing is asked of your wallet. The Opaq relayer pays the network fees. The fee is set on chain and capped at 1%.
          </p>
          <div className="row-btns">
            <button type="button" className="btn btn-secondary" onClick={move.closeDialog}>Not now</button>
            <button type="button" className="btn btn-primary" onClick={move.start}>Move to private balance</button>
          </div>
        </div>
      )}

      {running && (
        <div className="dlg" aria-busy="true">
          <h2 id="move-title">Moving your payments</h2>
          <span className="ph" aria-hidden="true" style={{ height: 10, width: "55%" }} />
          <p role="status">
            {progress
              ? `Payment ${progress.current} of ${progress.total}: ${MOVE_PHASE_LABEL[progress.phase]}.`
              : "Getting started."}
          </p>
          <p className="muted small">
            Proving that a balance is private takes some computing, so this can take a minute. Keep this tab open.
          </p>
        </div>
      )}

      {state.status === "done" && (
        <div className="dlg">
          <CbCircle name="privacy" size={56} />
          <h2 id="move-title">Your balance is private</h2>
          <p className="muted">
            {state.count === 1 ? "1 payment is" : `${state.count} payments are`} now in your private balance. Show amounts to
            see the total.
          </p>
          <button type="button" className="btn btn-primary" onClick={move.closeDialog}>Done</button>
        </div>
      )}

      {state.status === "error" && (
        <div className="dlg">
          <h2 id="move-title">Couldn&apos;t finish moving your payments</h2>
          <p className="notice" role="alert">
            <CbIcon name="info" size={18} />
            <span>{state.message} Nothing was lost: you can try again and it picks up where it stopped.</span>
          </p>
          <div className="row-btns">
            <button type="button" className="btn btn-secondary" onClick={move.closeDialog}>Close</button>
            <button type="button" className="btn btn-primary" onClick={move.start}>Try again</button>
          </div>
        </div>
      )}
    </dialog>
  );
}
