"use client";

import { GlyphKey, GlyphSignOut, GlyphUser, GlyphUserPlus, Icon } from "@/components/Icon";
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
            <h2 className="h-ic"><Icon as={GlyphUser} size={20} /> Account</h2>
            <p className="muted">This is a demo account. Create your own to get a handle and a payment link.</p>
            <div><button type="button" className="btn btn-primary" onClick={() => openAuth("create")}><Icon as={GlyphUserPlus} />Create account</button></div>
          </section>
        ) : (
          <>
            <section className="card stack" style={{ gap: 14 }}>
              <h2 className="h-ic"><Icon as={GlyphUser} size={20} /> Account</h2>
              <p>Handle: <strong>@{handle}</strong></p>
              <div><button type="button" className="btn btn-secondary" onClick={signOut}><Icon as={GlyphSignOut} />Sign out</button></div>
            </section>
            <section className="card stack" style={{ gap: 14 }}>
              <h2 className="h-ic"><Icon as={GlyphKey} size={20} /> Keys</h2>
              <p className="muted">Your spend key stays with you. Opaq cannot move your funds.</p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
