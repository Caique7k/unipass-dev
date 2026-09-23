"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Toaster } from "sonner";
import { useAuth } from "@/app/contexts/AuthContext";
import { SidebarProvider } from "@/app/contexts/SidebarContext";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { DashboardShellSkeleton } from "./components/DashboardSkeletons";
import { ACCENT } from "./components/primitives";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, loading, sessionExpired } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user && !sessionExpired) {
      router.push("/login");
    }
  }, [loading, user, sessionExpired, router]);

  if (loading) {
    return <DashboardShellSkeleton />;
  }

  if (!user && sessionExpired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div
            className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"
            style={{ borderColor: ACCENT, borderTopColor: "transparent" }}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            Sua sessão expirou. Redirecionando para o login...
          </p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <SidebarProvider>
      <div className="relative flex h-screen overflow-hidden bg-background">
        {/* Halo fixo de fundo: dá cor ao painel sem competir com o conteúdo. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full blur-3xl"
          style={{ backgroundColor: `${ACCENT}12` }}
        />

        <Sidebar />

        <div className="relative flex min-w-0 flex-1 flex-col">
          <Topbar />
          <Toaster richColors position="top-right" />

          <main className="unipass-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
