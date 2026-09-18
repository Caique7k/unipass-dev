import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BoardingSimulator } from "@/components/marketing/landing/BoardingSimulator";
import { CityHero } from "@/components/marketing/landing/CityHero";
import { DayTimeline } from "@/components/marketing/landing/DayTimeline";
import { LandingHeader } from "@/components/marketing/landing/LandingHeader";
import { Ledger } from "@/components/marketing/landing/Ledger";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f7f5] text-[#111111] antialiased transition-colors duration-300 dark:bg-[#0a0a0b] dark:text-[#f4f4f4]">
      <LandingHeader />
      <CityHero />
      <BoardingSimulator />
      <DayTimeline />
      <Ledger />

      <section className="border-t border-black/10 dark:border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-6 py-24 sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Escola, fretamento ou linha municipal:
            <br />
            <span className="text-[#111111]/40 dark:text-[#f4f4f4]/40">
              o ônibus é o mesmo. O controle, não.
            </span>
          </h2>
          <Link
            href="/cadastro/empresa"
            className="group inline-flex h-12 shrink-0 items-center gap-2 rounded-full bg-[#ff5c00] px-6 text-sm font-semibold text-white transition hover:bg-[#e65300]"
          >
            Cadastrar minha empresa
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-black/10 dark:border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-[#111111]/50 sm:flex-row sm:items-center sm:justify-between sm:px-8 dark:text-[#f4f4f4]/50">
          <div className="flex items-center gap-3">
            <Image
              src="/logo_unipass.svg"
              alt="UniPass"
              width={24}
              height={21}
              className="h-5 w-auto"
            />
            <span>© 2026 UniPass</span>
          </div>
          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className="transition hover:text-[#111111] dark:hover:text-[#f4f4f4]"
            >
              Entrar
            </Link>
            <Link
              href="/cadastro/empresa"
              className="transition hover:text-[#111111] dark:hover:text-[#f4f4f4]"
            >
              Criar conta
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
