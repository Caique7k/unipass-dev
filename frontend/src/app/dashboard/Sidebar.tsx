"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ChevronDown, LogOut } from "lucide-react";
import { useMemo, useState } from "react";
import { useSidebar } from "@/app/contexts/SidebarContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { roleLabels } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { buildNavGroups, isItemActive, type NavItem } from "./nav";
import { ACCENT, spring } from "./components/primitives";

export default function Sidebar() {
  const pathname = usePathname();
  const { isOpen } = useSidebar();
  const { user, loading, logout } = useAuth();
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);

  const groups = useMemo(() => buildNavGroups(user?.role), [user?.role]);

  function toggleGroup(id: string) {
    setCollapsedGroups((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  return (
    <motion.aside
      animate={{ width: isOpen ? 264 : 76 }}
      transition={spring}
      className="relative z-20 flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar/80 backdrop-blur-xl"
    >
      <div
        className={cn(
          "flex min-h-16 shrink-0 items-center gap-2.5 px-3",
          !isOpen && "justify-center px-0",
        )}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${ACCENT}14` }}
        >
          <Image
            src="/logo_unipass.svg"
            alt=""
            width={20}
            height={20}
            aria-hidden
          />
        </span>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              className="min-w-0 leading-tight"
            >
              {loading ? (
                <span className="block h-4 w-24 animate-pulse rounded bg-sidebar-accent" />
              ) : (
                <>
                  <p className="truncate text-sm font-semibold">
                    {user?.companyName ?? "UniPass"}
                  </p>
                  <p className="truncate text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {user?.role ? roleLabels[user.role] : ""}
                  </p>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <LayoutGroup id="sidebar-nav">
        <nav className="unipass-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
          {groups.map((group) => {
            const collapsed = isOpen && collapsedGroups.includes(group.id);
            const hasActive = group.items.some((item) =>
              isItemActive(item, pathname),
            );

            return (
              <div key={group.id} className="pt-2">
                {isOpen ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition hover:text-foreground"
                  >
                    {group.label}
                    <motion.span
                      animate={{ rotate: collapsed ? -90 : 0 }}
                      transition={spring}
                    >
                      <ChevronDown size={12} />
                    </motion.span>
                  </button>
                ) : (
                  <div
                    aria-hidden
                    className="mx-auto my-2 h-px w-8 bg-sidebar-border"
                  />
                )}

                <AnimatePresence initial={false}>
                  {!collapsed && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="mt-1 space-y-0.5 overflow-hidden"
                    >
                      {group.items.map((item) => (
                        <li key={item.href}>
                          <SidebarLink
                            item={item}
                            isOpen={isOpen}
                            active={isItemActive(item, pathname)}
                          />
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>

                {/* Com o grupo fechado, um traço lembra que há algo ativo dentro. */}
                {collapsed && hasActive && (
                  <div
                    aria-hidden
                    className="mx-3 mt-1 h-0.5 rounded-full"
                    style={{ backgroundColor: ACCENT }}
                  />
                )}
              </div>
            );
          })}
        </nav>
      </LayoutGroup>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <button
          onClick={logout}
          title="Sair"
          className={cn(
            "flex w-full cursor-pointer items-center rounded-xl py-2 text-sm text-red-500 transition hover:bg-red-500/10",
            isOpen ? "justify-start gap-3 px-3" : "justify-center",
          )}
        >
          <LogOut size={18} />
          <AnimatePresence initial={false}>
            {isOpen && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                Sair
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}

function SidebarLink({
  item,
  isOpen,
  active,
}: {
  item: NavItem;
  isOpen: boolean;
  active: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={isOpen ? undefined : item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center rounded-xl py-2 text-sm transition-colors",
        isOpen ? "justify-start gap-3 px-3" : "justify-center px-0",
        active
          ? "text-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={spring}
          className="absolute inset-0 rounded-xl border"
          style={{
            backgroundColor: `${ACCENT}16`,
            borderColor: `${ACCENT}40`,
          }}
        />
      )}

      <span
        className="relative shrink-0 transition-transform group-hover:scale-110"
        style={{ color: active ? ACCENT : undefined }}
      >
        <Icon size={18} />
      </span>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            className={cn("relative truncate", active && "font-medium")}
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}
