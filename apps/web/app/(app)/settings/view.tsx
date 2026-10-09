"use client";

import { PageHead } from "@/components/PageHead";
import { useSession } from "@/lib/session";

export function SettingsView() {
  const { isDemo, handle, openAuth, signOut } = useSession();
  return (
    <>
      <PageHead title="Settings">Your account and how Opaq looks for you.</PageHead>
      <div className="stack" style={{ maxWidth: 640 }}>
        {isDemo ? (
          <section className="card stack" style={{ gap: 14 }}>
            <h2>Account</h2>
            <p className="muted">This is a demo account. Create your own to get a handle and a payment link.</p>
            <div><button type="button" className="btn btn-primary" onClick={() => openAuth("create")}>Create account</button></div>
          </section>
        ) : (
          <>
            <section className="card stack" style={{ gap: 14 }}>
              <h2>Account</h2>
              <p>Handle: <strong>@{handle}</strong></p>
              <div><button type="button" className="btn btn-secondary" onClick={signOut}>Sign out</button></div>
            </section>
            <section className="card stack" style={{ gap: 14 }}>
              <h2>Keys</h2>
              <p className="muted">Your spend key stays with you. Opaq cannot move your funds.</p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
