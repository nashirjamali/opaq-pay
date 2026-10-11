"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

interface NavDrawer {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const Ctx = createContext<NavDrawer | null>(null);

/** Open state of the side menu that replaces the sidebar on phones. Closes on navigation and on Escape, and locks page scroll while open. */
export function NavDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = useState(false);
  const path = usePathname();
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);

  useEffect(() => setOpenState(false), [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenState(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.dataset.navOpen = "true";
    return () => {
      window.removeEventListener("keydown", onKey);
      delete document.body.dataset.navOpen;
    };
  }, [open]);

  const value = useMemo(() => ({ open, setOpen }), [open, setOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavDrawer(): NavDrawer {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNavDrawer must be used inside NavDrawerProvider");
  return v;
}
