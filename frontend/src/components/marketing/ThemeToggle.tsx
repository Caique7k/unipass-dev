"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/app/contexts/ThemeContext";

const noopSubscribe = () => () => {};

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  // ThemeProvider reads localStorage in its initial state, so the theme is
  // only trustworthy after hydration.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={
        mounted
          ? isDark
            ? "Ativar modo claro"
            : "Ativar modo escuro"
          : "Alternar tema"
      }
      className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full border border-black/10 text-[#111111] transition hover:border-black/30 dark:border-white/15 dark:text-[#f4f4f4] dark:hover:border-white/40"
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <span className="size-4" />
      )}
    </button>
  );
}
