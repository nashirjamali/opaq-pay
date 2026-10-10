"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/** Counts from 0 to `target` once when the target is set. Skips the motion for reduced-motion users. */
export function useCountUp(target: number, ms = 700): number {
  const [value, setValue] = useState(target);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || target === 0) return;
    setValue(0);
  }, [target]);

  useEffect(() => {
    // Animation frames pause in background tabs, so skip the motion there instead of stalling at 0.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setValue(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}
