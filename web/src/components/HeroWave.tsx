"use client";

import { useEffect, useState } from "react";
import { STRATEGY_NAMES, shapeCurve, type Strategy } from "@/lib/math";

const BARS = 44;
const CYCLE_MS = 2600;
const FLOOR = 8;
const SPOT_HEIGHT = 50;

export function HeroWave() {
  const [strategy, setStrategy] = useState<Strategy>(1);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setStrategy((s) => ((s + 1) % 3) as Strategy), CYCLE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative hidden h-28 max-w-md flex-1 items-end gap-0.5 md:flex" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => {
        const height = FLOOR + shapeCurve(strategy, (i + 0.5) / BARS) * (strategy === 0 ? SPOT_HEIGHT : 100 - FLOOR);
        const side = i < BARS / 2 - 1 ? undefined : i > BARS / 2 ? "var(--color-weth)" : "var(--color-now)";
        return <i key={i} className="hero-bar" style={{ height: `${height}%`, ...(side && { "--c": side }) } as React.CSSProperties} />;
      })}
      <span className="absolute -top-5 right-0 font-mono text-xs text-muted">{STRATEGY_NAMES[strategy]}</span>
    </div>
  );
}
