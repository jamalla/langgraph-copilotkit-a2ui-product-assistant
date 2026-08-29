"use client";

import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";

/**
 * Three-state theme control matching the token strategy in globals.css:
 * "system" removes data-theme entirely and lets prefers-color-scheme decide.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme") as Mode | null;
      if (saved) setMode(saved);
    } catch {
      /* private mode / blocked storage - the system default is fine */
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    try {
      localStorage.setItem("theme", mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const next: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
  const icon: Record<Mode, string> = { system: "◐", light: "☀", dark: "☾" };

  return (
    <button
      type="button"
      onClick={() => setMode(next[mode])}
      title={`Theme: ${mode} - click for ${next[mode]}`}
      aria-label={`Theme: ${mode}`}
      className="grid size-8 place-items-center rounded-control border border-line bg-surface text-sm text-ink-muted transition hover:border-line-strong hover:text-ink"
    >
      {icon[mode]}
    </button>
  );
}
