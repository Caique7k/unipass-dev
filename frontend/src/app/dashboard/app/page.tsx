import Image from "next/image";
import QRCode from "qrcode";
import { Download, ExternalLink, QrCode, ScanLine } from "lucide-react";
import { PageHeader, StatusBadge } from "../components/page-kit";
import { Panel, SectionLabel } from "../components/primitives";

const androidUrl = process.env.NEXT_PUBLIC_ANDROID_APP_URL?.trim() ?? "";
const iosUrl = process.env.NEXT_PUBLIC_IOS_APP_URL?.trim() ?? "";

async function buildQrCode(url: string) {
  if (!url) return null;

  try {
    return await QRCode.toDataURL(url, {
      width: 256,
      margin: 4,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#FFFFFF" },
    });
  } catch {
    return null;
  }
}

type AppDownload = {
  title: string;
  subtitle: string;
  description: string;
  url: string;
  qrCode: string | null;
  accent: string;
};

export default async function AppPage() {
  const [androidQrCode, iosQrCode] = await Promise.all([
    buildQrCode(androidUrl),
    buildQrCode(iosUrl),
  ]);

  const downloads: AppDownload[] = [
    {
      title: "Android",
      subtitle: "APK para instalação direta",
      description:
        "Escaneie com a câmera do celular para abrir o download do app no Android.",
      url: androidUrl,
      qrCode: androidQrCode,
      accent: "#16a34a",
    },
    {
      title: "iOS",
      subtitle: "Link de instalação para iPhone",
      description:
        "Escaneie com a câmera do iPhone para abrir a página de instalação do app.",
      url: iosUrl,
      qrCode: iosQrCode,
      accent: "#2563eb",
    },
  ];

  const configuredCount = downloads.filter(
    (download) => Boolean(download.url && download.qrCode),
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Aplicativo"
        title="App do responsável"
        description="Compartilhe os links oficiais de instalação por QR code. Quem escaneia vai direto para o download."
        meta={
          <StatusBadge tone={configuredCount === 2 ? "success" : "warning"}>
            {configuredCount}/2 links configurados
          </StatusBadge>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-4 lg:grid-cols-2">
          {downloads.map((download) => (
            <DownloadCard key={download.title} download={download} />
          ))}
        </div>

        <aside className="space-y-4">
          <Panel className="p-5">
            <SectionLabel>Como usar</SectionLabel>
            <ol className="mt-3 space-y-2.5">
              {[
                "Abra a câmera do celular ou um leitor de QR code.",
                "Escaneie o card da plataforma desejada.",
                "Toque no link aberto para iniciar a instalação.",
              ].map((step, index) => (
                <li key={step} className="flex gap-2.5 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold tabular-nums">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel className="p-5">
            <SectionLabel>Links configuráveis</SectionLabel>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Os QR codes usam as variáveis{" "}
              <code className="rounded bg-accent px-1 py-0.5 font-mono text-[11px]">
                NEXT_PUBLIC_ANDROID_APP_URL
              </code>{" "}
              e{" "}
              <code className="rounded bg-accent px-1 py-0.5 font-mono text-[11px]">
                NEXT_PUBLIC_IOS_APP_URL
              </code>
              . Configure o link e refaça o build para liberar o card.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function DownloadCard({ download }: { download: AppDownload }) {
  const isReady = Boolean(download.url && download.qrCode);

  return (
    <Panel className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <SectionLabel>{download.subtitle}</SectionLabel>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {download.title}
          </h2>
        </div>

        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
          style={{
            backgroundColor: `${download.accent}1a`,
            color: download.accent,
          }}
        >
          {isReady ? <QrCode size={18} /> : <ScanLine size={18} />}
        </span>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {download.description}
      </p>

      <div className="mt-4 flex justify-center rounded-2xl border border-border/60 bg-white p-4">
        {isReady ? (
          <Image
            src={download.qrCode ?? ""}
            alt={`QR code para download no ${download.title}`}
            width={208}
            height={208}
            unoptimized
            className="object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div className="flex h-[208px] w-[208px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 px-5 text-center">
            <QrCode size={28} className="text-zinc-400" />
            <p className="text-sm font-medium text-zinc-700">
              Link ainda não configurado
            </p>
            <p className="text-xs text-zinc-500">
              Defina a URL oficial desta plataforma para liberar o QR code.
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-border/50 bg-background/50 px-3 py-2.5">
        <SectionLabel>Link atual</SectionLabel>
        <p className="mt-1 break-all text-xs font-medium">
          {download.url || "Aguardando configuração do link"}
        </p>
      </div>

      {isReady ? (
        <a
          href={download.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition hover:brightness-110"
          style={{ backgroundColor: download.accent }}
        >
          Baixar agora
          <ExternalLink size={14} />
        </a>
      ) : (
        <div className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground">
          <Download size={14} />
          Link pendente
        </div>
      )}
    </Panel>
  );
}
