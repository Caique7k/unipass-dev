"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/marketing/ThemeToggle";

export function AuthShell({
  children,
  backHref = "/",
  backLabel = "Voltar",
  aside,
}: {
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
  aside?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#f7f7f5] text-[#111111] antialiased transition-colors duration-300 dark:bg-[#0a0a0b] dark:text-[#f4f4f4]">
      <header className="sticky top-0 z-30 bg-[#f7f7f5]/70 backdrop-blur-md dark:bg-[#0a0a0b]/70">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 sm:px-8">
          <Link href="/" aria-label="UniPass" className="flex items-center">
            <Image
              src="/logo_unipass.svg"
              alt="UniPass"
              width={32}
              height={28}
              className="h-7 w-auto"
              priority
            />
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              href={backHref}
              className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-[#111111]/70 transition hover:text-[#111111] dark:text-[#f4f4f4]/70 dark:hover:text-[#f4f4f4]"
            >
              <ArrowLeft className="size-4" />
              {backLabel}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
        {aside ? (
          <div className="grid min-h-[calc(100svh-4rem)] gap-12 py-12 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-center lg:py-0">
            <div className="order-2 lg:order-1">{aside}</div>
            <div className="order-1 lg:order-2">{children}</div>
          </div>
        ) : (
          children
        )}
      </div>
    </main>
  );
}
