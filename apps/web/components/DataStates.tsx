"use client";

import { useSession } from "@/lib/session";
import { CbIcon } from "./CbIcon";

/** Shown when the last scan failed. Says what happened and what to do, and never touches funds. */
export function ErrorBanner() {
  const { dataState, dataError, refresh } = useSession();
  if (dataState !== "error") return null;
  return (
    <div className="banner banner-error" role="alert">
      <p className="banner-text">
        <CbIcon name="error" size={20} />
        <span>
          <strong>Couldn&apos;t load your payments.</strong> {dataError} Your funds are not affected.
        </span>
      </p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={refresh}>
        Try again
      </button>
    </div>
  );
}

export function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <ul className="list" aria-busy="true">
      <li className="sr">Loading payments</li>
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div className="row" aria-hidden="true">
            <span className="tile" />
            <span><span className="ph" style={{ width: "60%" }} /></span>
            <span className="c-status"><span className="ph" style={{ width: 80 }} /></span>
            <span className="amt"><span className="ph" style={{ width: 70 }} /></span>
          </div>
        </li>
      ))}
    </ul>
  );
}
