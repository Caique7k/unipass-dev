"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { buildNavGroups, type NavItem } from "./nav";
import { ACCENT } from "./components/primitives";

/** Remove acentos para que "onibus" encontre "Ônibus". */
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AnimatePresence>
      {/* O diálogo só monta quando aberto, então busca e seleção já nascem limpas. */}
      {open && <PaletteDialog onClose={() => onOpenChange(false)} />}
    </AnimatePresence>
  );
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  const entries = useMemo(() => {
    const groups = buildNavGroups(user?.role);

    return groups.flatMap((group) =>
      group.items.map((item) => ({ group: group.label, item })),
    );
  }, [user?.role]);

  const results = useMemo(() => {
    const term = normalize(query.trim());

    if (!term) return entries;

    return entries.filter(({ item, group }) => {
      const haystack = [item.label, group, ...(item.keywords ?? [])]
        .map(normalize)
        .join(" ");

      return haystack.includes(term);
    });
  }, [entries, query]);

  function go(item: NavItem) {
    onClose();
    router.push(item.href);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((prev) => (prev + 1) % Math.max(results.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted(
        (prev) => (prev - 1 + results.length) % Math.max(results.length, 1),
      );
    } else if (event.key === "Enter" && results[highlighted]) {
      event.preventDefault();
      go(results[highlighted].item);
    } else if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Busca do painel"
    >
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-border/60 bg-popover/95 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-3 border-b border-border/60 px-4">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            // O foco vai pelo ref callback: autoFocus não é confiável junto da
            // animação de entrada do diálogo.
            ref={(node) => node?.focus()}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar páginas do painel..."
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        <div className="unipass-scrollbar max-h-[320px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nada encontrado para “{query}”.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {results.map(({ item, group }, index) => {
                const Icon = item.icon;
                const isHighlighted = index === highlighted;

                return (
                  <li key={item.href}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition",
                        isHighlighted ? "bg-accent" : "hover:bg-accent/60",
                      )}
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          backgroundColor: `${ACCENT}14`,
                          color: ACCENT,
                        }}
                      >
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {group}
                      </span>
                      {isHighlighted && (
                        <CornerDownLeft
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
