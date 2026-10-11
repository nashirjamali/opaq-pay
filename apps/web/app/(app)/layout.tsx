import { AuthDialog } from "@/components/AuthDialog";
import { AuthOnLoad } from "@/components/AuthOnLoad";
import { DemoBanner } from "@/components/DemoBanner";
import { Header } from "@/components/Header";
import { MoveDialog } from "@/components/MoveDialog";
import { Nav } from "@/components/Nav";
import { NavDrawerProvider } from "@/lib/navDrawer";
import { SessionProvider } from "@/lib/session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <NavDrawerProvider>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        <Nav />
        <div className="col">
          <Header />
          <main id="main" tabIndex={-1}>
            <DemoBanner />
            {children}
          </main>
        </div>
      </div>
      </NavDrawerProvider>
      <AuthOnLoad />
      <AuthDialog />
      <MoveDialog />
    </SessionProvider>
  );
}
