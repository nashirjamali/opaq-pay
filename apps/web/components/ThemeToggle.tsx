"use client";

import { useEffect, useState } from "react";
import { GlyphMoon, GlyphSun, Icon } from "./Icon";

/** `nav` is the full-width sidebar row; the default is the round icon button used on the payer page. */
export function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "nav" }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("opaq-theme", next);
    } catch {
      /* storage can be blocked; the toggle still works for this visit */
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={variant === "nav" ? "nav-theme" : "btn btn-secondary theme-btn"}
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      <Icon as={theme === "light" ? GlyphMoon : GlyphSun} />
      <span className="theme-label">{theme === "light" ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}
