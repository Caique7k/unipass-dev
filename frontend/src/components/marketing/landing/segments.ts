export type SegmentId = "escolar" | "fretamento" | "publico";

export type Segment = {
  id: SegmentId;
  label: string;
  eyebrow: string;
  title: [string, string];
  description: string;
  passengerNoun: string;
};

export const segments: Segment[] = [
  {
    id: "escolar",
    label: "Transporte escolar",
    eyebrow: "Escolas e famílias",
    title: ["Cada aluno a bordo,", "na hora certa."],
    description:
      "A TAG do aluno registra o embarque no UniHub. A escola vê quem está no ônibus, a família recebe a confirmação e a mensalidade sai sozinha no fim do mês.",
    passengerNoun: "alunos",
  },
  {
    id: "fretamento",
    label: "Fretamento e turismo",
    eyebrow: "Empresas e excursões",
    title: ["Lotação, rota e cobrança", "em um único painel."],
    description:
      "Passageiros identificados por TAG, ocupação real por veículo e localização ao vivo para quem contrata e para quem opera.",
    passengerNoun: "passageiros",
  },
  {
    id: "publico",
    label: "Transporte público",
    eyebrow: "Municípios e concessionárias",
    title: ["Dados de verdade", "sobre cada linha."],
    description:
      "Embarques e desembarques por parada, ocupação em tempo real e histórico por linha. O que hoje é estimativa vira medição.",
    passengerNoun: "passageiros",
  },
];

export const segmentById = Object.fromEntries(
  segments.map((segment) => [segment.id, segment]),
) as Record<SegmentId, Segment>;
