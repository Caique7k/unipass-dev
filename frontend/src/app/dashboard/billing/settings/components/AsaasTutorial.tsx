"use client";

import { ArrowRight } from "lucide-react";
import { GhostButton, PrimaryButton } from "@/app/dashboard/components/page-kit";
import { Panel, PanelHeader } from "@/app/dashboard/components/primitives";

// Só o que o UniPass faz de fato e o que a documentação oficial do Asaas diz;
// nada de promessa sobre taxas, prazos ou aprovação de conta.
const STEPS = [
  {
    title: "O Asaas é opcional",
    text: "Sua empresa decide. Dá para ligar ou desligar a integração quando quiser.",
  },
  {
    title: "O UniPass funciona sem ele",
    text: "Com o gateway próprio, a emissão e o acompanhamento de boletos continuam como hoje, sem nenhuma chamada ao Asaas.",
  },
  {
    title: "Para que serve",
    text: "Com o Asaas, o UniPass cria as cobranças (boleto e Pix) e acompanha o pagamento de cada uma.",
  },
  {
    title: "Conta no Asaas",
    text: "A empresa precisa ter a própria conta no Asaas. O dinheiro das cobranças é da conta da empresa, não do UniPass.",
  },
  {
    title: "Chave de API",
    text: "No painel do Asaas, em Integrações → Chave de API, gere uma chave e cole aqui. Ela fica guardada criptografada e nunca é mostrada de novo.",
  },
  {
    title: "Emissão pela API",
    text: "O UniPass usa a API do Asaas para emitir as cobranças em nome da empresa, com os dados do pagador e o valor do grupo de boletos.",
  },
  {
    title: "Status pelo webhook",
    text: "Pagamentos, vencimentos e cancelamentos chegam ao UniPass pelo webhook do Asaas e atualizam cada cobrança sozinhos.",
  },
  {
    title: "Proteção de dados",
    text: "Para emitir, nome, CPF/CNPJ e e-mail do pagador são enviados ao Asaas. Esse tratamento precisa seguir a política de privacidade da empresa e a LGPD.",
  },
  {
    title: "Revise antes de emitir",
    text: "Confira pagador, valor e vencimento antes de emitir: a cobrança emitida chega ao pagador.",
  },
];

export function AsaasTutorial({
  onConfigure,
  onSkip,
  busy,
}: {
  onConfigure: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  return (
    <Panel>
      <PanelHeader
        title="Antes de configurar o Asaas"
        hint="Como a integração funciona, em 9 pontos."
      />
      <ol className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-2xl border border-border/60 bg-background/60 p-4"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ff5c00]/10 text-xs font-semibold text-[#ff5c00]">
                {index + 1}
              </span>
              <p className="text-sm font-medium">{step.title}</p>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {step.text}
            </p>
          </li>
        ))}
      </ol>
      <div className="flex flex-col-reverse gap-2 border-t border-border/60 px-5 py-4 sm:flex-row sm:justify-end">
        <GhostButton onClick={onSkip} disabled={busy}>
          Continuar sem Asaas
        </GhostButton>
        <PrimaryButton onClick={onConfigure} disabled={busy}>
          Configurar Asaas
          <ArrowRight size={14} />
        </PrimaryButton>
      </div>
    </Panel>
  );
}
