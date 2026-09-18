"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

const rows = [
  {
    label: "Alunos e passageiros",
    detail:
      "Cadastro com matrícula, grupo, rotas e TAG. No transporte público, o passageiro é a leitura — sem cadastro individual.",
    meta: "TAG RFID · grupos · rotas",
  },
  {
    label: "Ônibus e UniHubs",
    detail:
      "Cada veículo tem capacidade e um UniHub pareado por código na tela. Trocou de ônibus? Vincula de novo em segundos.",
    meta: "pareamento · capacidade · 4G",
  },
  {
    label: "Rotas e horários",
    detail:
      "Ida, volta e turnos por dia da semana. A notificação de confirmação sai automaticamente antes da saída.",
    meta: "GO · BACK · SHIFT",
  },
  {
    label: "Localização ao vivo",
    detail:
      "Posição do veículo a cada poucos segundos, com estado claro: ao vivo, atrasado ou sem dispositivo.",
    meta: "GPS · 45 s",
  },
  {
    label: "Cobranças",
    detail:
      "Grupos de cobrança com valor, vencimento e recorrência. Emissão em lote por mês, sem duplicar.",
    meta: "mensal · bimestral · anual",
  },
  {
    label: "Relatórios",
    detail:
      "Movimentação, frequência, frota, rotas e grupos — por período, com exportação.",
    meta: "5 relatórios",
  },
];

export function Ledger() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="border-t border-black/10 py-24 dark:border-white/10">
      <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#ff5c00]">
              O que entra no painel
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Tudo que hoje está
              <br />
              em seis lugares.
            </h2>
            <p className="mt-5 max-w-sm text-base leading-7 text-[#111111]/65 dark:text-[#f4f4f4]/65">
              Passe o mouse ou toque em cada linha.
            </p>
          </div>

          <ul className="divide-y divide-black/10 border-y border-black/10 dark:divide-white/10 dark:border-white/10">
            {rows.map((row, index) => {
              const active = open === index;
              return (
                <li
                  key={row.label}
                  onMouseEnter={() => setOpen(index)}
                  onClick={() => setOpen(active ? null : index)}
                  className="cursor-pointer py-5"
                >
                  <div className="flex items-baseline justify-between gap-6">
                    <span className="flex items-baseline gap-4">
                      <span className="font-mono text-[11px] text-[#111111]/40 dark:text-[#f4f4f4]/40">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`text-xl font-semibold tracking-[-0.02em] transition-colors sm:text-2xl ${
                          active ? "text-[#ff5c00]" : ""
                        }`}
                      >
                        {row.label}
                      </span>
                    </span>
                    <span className="hidden font-mono text-[11px] text-[#111111]/45 sm:block dark:text-[#f4f4f4]/45">
                      {row.meta}
                    </span>
                  </div>
                  <AnimatePresence initial={false}>
                    {active && (
                      <motion.p
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                        className="overflow-hidden pl-9 text-sm leading-7 text-[#111111]/60 dark:text-[#f4f4f4]/60"
                      >
                        <span className="block pt-3">{row.detail}</span>
                      </motion.p>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
