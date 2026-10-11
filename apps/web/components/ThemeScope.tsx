"use client";

import { useLayoutEffect } from "react";

// Runs before the app shell below it paints, so the saved theme never flashes.
const themeScript = `try{if(localStorage.getItem("opaq-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

/**
 * Dark mode belongs to the signed-in app only. The landing page and the payer page are always light,
 * so the saved theme is applied while the app is on screen and light is restored when leaving it.
 */
export function ThemeScope() {
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem("opaq-theme") === "dark") document.documentElement.dataset.theme = "dark";
    } catch {
      /* storage can be blocked; the app stays light */
    }
    return () => {
      document.documentElement.dataset.theme = "light";
    };
  }, []);
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
