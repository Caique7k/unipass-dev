"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { ThemeToggle } from "@/components/marketing/ThemeToggle";

export function LandingHeader() {
  const { scrollY } = useScroll();
  const borderOpacity = useTransform(scrollY, [0, 80], [0, 1]);

  return (
    <header className="sticky top-0 z-30 bg-[#f7f7f5]/70 backdrop-blur-md dark:bg-[#0a0a0b]/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 sm:px-8">
        <Link href="/" aria-label="UniPass" className="flex items-center gap-3">
          <Image
            src="/logo_unipass.svg"
            alt="UniPass"
            width={32}
            height={28}
            className="h-7 w-auto"
            priority
          />
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-[#111111]/50 sm:block dark:text-[#f4f4f4]/50">
            escolar · fretamento · público
          </span>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-full px-4 text-sm font-medium text-[#111111]/70 transition hover:text-[#111111] dark:text-[#f4f4f4]/70 dark:hover:text-[#f4f4f4]"
          >
            Entrar
          </Link>
          <Link
            href="/cadastro/empresa"
            className="inline-flex h-10 items-center rounded-full bg-[#111111] px-5 text-sm font-medium text-white transition hover:bg-[#ff5c00] dark:bg-[#f4f4f4] dark:text-[#0b0b0c] dark:hover:bg-[#ff5c00] dark:hover:text-white"
          >
            Criar conta
          </Link>
        </nav>
      </div>
      <motion.div
        style={{ opacity: borderOpacity }}
        className="h-px w-full bg-black/10 dark:bg-white/10"
      />
    </header>
  );
}
