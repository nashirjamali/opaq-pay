"use client";

import { useEffect, useState } from "react";
import { GlyphMoon, GlyphSun, Icon } from "./Icon";

export function ThemeToggle() {
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
      className="btn btn-secondary"
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      <Icon as={theme === "light" ? GlyphMoon : GlyphSun} />
      {theme === "light" ? "Dark mode" : "Light mode"}
    </button>
  );
}
