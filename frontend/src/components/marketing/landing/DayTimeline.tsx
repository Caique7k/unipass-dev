"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";

type Moment = {
  time: string;
  tag: string;
  title: string;
  text: string;
  data?: string;
};

const moments: Moment[] = [
  {
    time: "05:40",
    tag: "UniHub",
    title: "Veículo sai da garagem",
    text: "O UniHub liga, conecta no 4G e começa a enviar posição. O ônibus aparece no mapa antes da primeira parada.",
    data: "GPS · 4G · online",
  },
  {
    time: "06:52",
    tag: "RFID",
    title: "Primeira TAG lida",
    text: "Ana aproxima a TAG. O backend confirma que ela é aluna ativa da empresa e registra o embarque.",
    data: "BOARDING · 31/42",
  },
  {
    time: "07:10",
    tag: "Escola",
    title: "Chegada e desembarque",
    text: "Cada saída vira um evento. A coordenação sabe quem chegou sem passar lista.",
    data: "DEBOARDING × 31",
  },
  {
    time: "12:05",
    tag: "Linha 214",
    title: "Ocupação por parada",
    text: "No transporte público, embarques e desembarques por ponto mostram onde a linha enche e onde esvazia.",
    data: "63/80 · Av. Brasil",
  },
  {
    time: "16:30",
    tag: "Push",
    title: "“Vai usar o transporte hoje?”",
    text: "A família responde pela notificação. A confirmação já entra no painel antes do ônibus sair.",
    data: "confirmação · sim",
  },
  {
    time: "17:30",
    tag: "RFID",
    title: "Segunda leitura do dia",
    text: "A TAG lida na volta encerra o ciclo do aluno. Quem ainda não passou aparece em “aguardando”.",
    data: "retorno · 2º embarque",
  },
  {
    time: "dia 10",
    tag: "Cobrança",
    title: "Mensalidades emitidas",
    text: "Os boletos saem pelo grupo de cobrança de cada aluno, com valor e vencimento herdados do template.",
    data: "42 cobranças · R$ 350",
  },
];

export function DayTimeline() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [distance, setDistance] = useState(0);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      setWide(media.matches);
      const track = trackRef.current;
      if (track) {
        setDistance(Math.max(0, track.scrollWidth - window.innerWidth));
      }
    };
    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 24 });
  const x = useTransform(progress, [0, 1], [0, -distance]);
  const busLeft = useTransform(progress, [0, 1], ["0%", "100%"]);

  return (
    <section
      ref={sectionRef}
      className={`border-t border-black/10 dark:border-white/10 ${wide ? "h-[320vh]" : ""}`}
    >
      <div className={wide ? "sticky top-16 overflow-hidden" : ""}>
        <div className="mx-auto w-full max-w-6xl px-6 pt-24 sm:px-8">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#ff5c00]">
            Um dia de operação
          </p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Da garagem ao boleto,
              <br />
              sem uma planilha no caminho.
            </h2>
            {wide && (
              <p className="max-w-xs text-sm text-[#111111]/50 dark:text-[#f4f4f4]/50">
                Continue rolando — a linha do tempo acompanha o scroll.
              </p>
            )}
          </div>

          <div className="relative mt-12 h-px w-full bg-black/10 dark:bg-white/10">
            <motion.div
              style={{ left: busLeft }}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              <span className="block size-3 rounded-full bg-[#ff5c00] shadow-[0_0_0_6px_rgba(255,92,0,0.15)]" />
            </motion.div>
          </div>
        </div>

        <motion.div
          ref={trackRef}
          style={wide ? { x } : undefined}
          className={`flex gap-5 px-6 pb-24 pt-10 sm:px-8 ${
            wide
              ? "w-max pl-[max(1.5rem,calc((100vw-72rem)/2+2rem))]"
              : "snap-x snap-mandatory overflow-x-auto"
          }`}
        >
          {moments.map((moment, index) => (
            <motion.article
              key={moment.time + moment.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: wide ? 0 : index * 0.05 }}
              className="flex w-[19rem] shrink-0 snap-start flex-col justify-between rounded-[28px] border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-[#141416] sm:w-[22rem]"
            >
              <div>
                <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider">
                  <span className="text-[#ff5c00]">{moment.tag}</span>
                  <span className="text-[#111111]/45 dark:text-[#f4f4f4]/45">
                    {moment.time}
                  </span>
                </div>
                <h3 className="mt-6 text-xl font-semibold leading-snug tracking-[-0.02em]">
                  {moment.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[#111111]/60 dark:text-[#f4f4f4]/60">
                  {moment.text}
                </p>
              </div>
              {moment.data && (
                <p className="mt-8 rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-[11px] text-[#111111]/70 dark:bg-white/[0.06] dark:text-[#f4f4f4]/70">
                  {moment.data}
                </p>
              )}
            </motion.article>
          ))}
          {wide && (
            <div className="w-[calc(100vw-22rem)] shrink-0" aria-hidden="true" />
          )}
        </motion.div>
      </div>
    </section>
  );
}
