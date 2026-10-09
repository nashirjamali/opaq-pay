import { AuthDialog } from "@/components/AuthDialog";
import { DemoBanner } from "@/components/DemoBanner";
import { Header } from "@/components/Header";
import { Nav } from "@/components/Nav";
import { SessionProvider } from "@/lib/session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <a className="skip" href="#main">Skip to content</a>
      <Header />
      <div className="body">
        <Nav />
        <main id="main" tabIndex={-1}>
          <DemoBanner />
          {children}
        </main>
      </div>
      <AuthDialog />
    </SessionProvider>
  );
}
