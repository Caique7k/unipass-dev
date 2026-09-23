"use client";

import { HelpCircle } from "lucide-react";
import { FormModal, ModalCancelButton } from "../../components/FormModal";
import { ACCENT } from "../../components/primitives";

const steps = [
  {
    title: "Ligue o UniHub",
    description:
      "Ao ligar, o dispositivo pede um código temporário ao servidor automaticamente.",
  },
  {
    title: "Leia o código na tela",
    description:
      "São 6 caracteres exibidos no próprio dispositivo. Ele vale por 10 minutos.",
  },
  {
    title: "Conclua aqui no painel",
    description:
      'Clique em "Parear dispositivo", informe o código e escolha o ônibus.',
  },
  {
    title: "Pronto",
    description:
      "O UniHub recebe credenciais definitivas e passa a registrar embarques e localização.",
  },
];

export function CreateDeviceModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      icon={<HelpCircle size={18} />}
      title="Como funciona o pareamento"
      description="Quatro passos para conectar um novo UniHub à sua operação."
      footer={<ModalCancelButton onClick={() => onOpenChange(false)}>Entendi</ModalCancelButton>}
    >
      <ol className="relative space-y-4 pl-8">
        {/* trilho vertical ligando os passos */}
        <span
          aria-hidden
          className="absolute left-[11px] top-3 bottom-3 w-px bg-border"
        />

        {steps.map((step, index) => (
          <li key={step.title} className="relative">
            <span
              className="absolute -left-8 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-4 ring-card"
              style={{ backgroundColor: ACCENT }}
            >
              {index + 1}
            </span>

            <p className="text-sm font-medium">{step.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {step.description}
            </p>
          </li>
        ))}
      </ol>
    </FormModal>
  );
}
