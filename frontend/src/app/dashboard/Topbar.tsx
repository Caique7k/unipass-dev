"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { useTheme } from "@/app/contexts/ThemeContext";
import { roleLabels } from "@/lib/permissions";
import { buildNavGroups, findActiveItem } from "./nav";
import { CommandPalette } from "./CommandPalette";
import { ACCENT, spring } from "./components/primitives";

export default function Topbar() {
  const { isOpen, toggle } = useSidebar();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const homeHref =
    user?.role === "PLATFORM_ADMIN" ? "/dashboard/companies" : "/dashboard";

  const active = useMemo(
    () => findActiveItem(buildNavGroups(user?.role), pathname),
    [user?.role, pathname],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 h-16 shrink-0 border-b border-border/50 bg-background/80 px-3 backdrop-blur-xl md:px-5">
        <div className="flex h-full items-center gap-3">
          <button
            onClick={toggle}
            aria-label={isOpen ? "Recolher menu" : "Expandir menu"}
            className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border/60 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <motion.span
              animate={{ rotate: isOpen ? 0 : 180 }}
              transition={spring}
              className="flex"
            >
              <PanelLeft size={16} />
            </motion.span>
          </button>

          {/* Trilha: UniPass › Grupo › Página */}
          <nav
            aria-label="Trilha de navegação"
            className="flex min-w-0 items-center gap-1.5 text-sm"
          >
            <Link
              href={homeHref}
              className="shrink-0 font-semibold transition hover:opacity-80"
              style={{ color: ACCENT }}
            >
              UniPass
            </Link>

            <AnimatePresence mode="wait">
              {active && (
                <motion.span
                  key={active.item.href}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 4 }}
                  transition={{ duration: 0.18 }}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <ChevronRight
                    size={13}
                    className="shrink-0 text-muted-foreground/60"
                  />
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">
                    {active.group.label}
                  </span>
                  <ChevronRight
                    size={13}
                    className="hidden shrink-0 text-muted-foreground/60 sm:block"
                  />
                  <span className="truncate font-medium">
                    {active.item.label}
                  </span>
                </motion.span>
              )}
            </AnimatePresence>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-border/60 px-2.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Search size={14} />
              <span className="hidden lg:inline">Buscar</span>
              <kbd className="hidden rounded border border-border/70 px-1 py-0.5 text-[10px] lg:block">
                Ctrl K
              </kbd>
            </button>

            <button
              onClick={toggleTheme}
              aria-label={
                theme === "dark" ? "Usar modo claro" : "Usar modo escuro"
              }
              className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-border/60 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ y: 14, opacity: 0, rotate: -30 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  exit={{ y: -14, opacity: 0, rotate: 30 }}
                  transition={{ duration: 0.2 }}
                  className="flex"
                >
                  {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
                </motion.span>
              </AnimatePresence>
            </button>

            <div className="flex items-center gap-2 rounded-xl border border-border/60 px-2 py-1.5">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: ACCENT }}
              >
                {user?.name?.charAt(0)?.toUpperCase()}
              </span>
              <div className="hidden max-w-[150px] leading-tight lg:block">
                <p className="truncate text-xs font-medium">{user?.name}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {user?.role ? roleLabels[user.role] : ""}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
