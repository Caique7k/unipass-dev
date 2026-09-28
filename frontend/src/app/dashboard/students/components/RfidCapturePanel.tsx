"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Nfc, RotateCcw, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useRfidCapture, type CaptureDevice } from "../hooks/useRfidCapture";

function deviceLabel(device: CaptureDevice) {
  const name = device.name || device.code || "UniHub";
  return device.bus?.plate && device.bus.plate !== name
    ? `${name} · ${device.bus.plate}`
    : name;
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  return <>{Math.max(0, Math.ceil((expiresAt - now) / 1000))}s</>;
}

/**
 * Lê a TAG direto do UniHub escolhido e entrega o código ao formulário.
 * Não vincula sozinho: quem confirma é o admin, no botão do modal.
 */
export function RfidCapturePanel({
  enabled,
  onCaptured,
}: {
  enabled: boolean;
  onCaptured: (tag: string) => void;
}) {
  const capture = useRfidCapture(enabled);
  const { state } = capture;
  const capturedTag = state.status === "captured" ? state.tag : null;

  useEffect(() => {
    if (capturedTag) onCaptured(capturedTag);
  }, [capturedTag, onCaptured]);

  if (!capture.devicesLoading && capture.devices.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-background/80 p-4 text-sm text-muted-foreground">
        Nenhum UniHub pareado nesta empresa. Pareie um em{" "}
        <span className="font-medium text-foreground">UniHub</span> para
        ler a TAG pelo leitor, ou digite o código abaixo.
      </div>
    );
  }

  const selected = capture.devices.find((d) => d.id === capture.deviceId);
  const busy = state.status === "starting" || state.status === "waiting";

  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-card/70 p-4 text-left">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          value={capture.deviceId}
          onValueChange={(value) => capture.setDeviceId(value ?? "")}
          disabled={busy || capture.devicesLoading}
        >
          <SelectTrigger className="h-11 flex-1 rounded-xl">
            <SelectValue placeholder="Escolha o UniHub">
              {selected ? deviceLabel(selected) : "Carregando UniHubs..."}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {capture.devices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {deviceLabel(device)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {busy ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            onClick={capture.cancel}
          >
            <X size={16} /> Cancelar
          </Button>
        ) : (
          <Button
            type="button"
            className="h-11 rounded-xl bg-[#ff5c00] text-white hover:bg-[#ff5c00]/90"
            onClick={capture.start}
            disabled={!capture.deviceId}
          >
            {state.status === "idle" ? (
              <Nfc size={16} />
            ) : (
              <RotateCcw size={16} />
            )}
            {state.status === "idle" ? "Ler TAG no UniHub" : "Ler novamente"}
          </Button>
        )}
      </div>

      <div
        aria-live="polite"
        className={cn(
          "flex items-start gap-2 rounded-xl px-3 py-2 text-sm",
          state.status === "captured" &&
            !state.alreadyRegistered &&
            "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          ((state.status === "captured" && state.alreadyRegistered) ||
            state.status === "error" ||
            state.status === "expired") &&
            "bg-amber-500/10 text-amber-700 dark:text-amber-300",
          (state.status === "idle" ||
            state.status === "starting" ||
            state.status === "waiting") &&
            "bg-muted/50 text-muted-foreground",
        )}
      >
        {state.status === "idle" && (
          <span>
            Enquanto a leitura estiver aberta, este UniHub não registra
            embarques — só captura a próxima TAG.
          </span>
        )}
        {state.status === "starting" && (
          <>
            <Spinner className="mt-0.5 size-4" /> Preparando o UniHub...
          </>
        )}
        {state.status === "waiting" && (
          <>
            <Spinner className="mt-0.5 size-4" />
            <span>
              Aproxime a TAG do UniHub agora.{" "}
              <span className="tabular-nums">
                <Countdown expiresAt={state.expiresAt} />
              </span>
            </span>
          </>
        )}
        {state.status === "captured" && !state.alreadyRegistered && (
          <>
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <span>
              TAG <strong className="font-mono">{state.tag}</strong> lida.
              Confira e clique em Confirmar vínculo.
            </span>
          </>
        )}
        {state.status === "captured" && state.alreadyRegistered && (
          <>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              A TAG <strong className="font-mono">{state.tag}</strong> já está
              cadastrada
              {state.linkedStudentName
                ? ` para ${state.linkedStudentName}`
                : ""}
              . Use outra TAG.
            </span>
          </>
        )}
        {state.status === "expired" && (
          <>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            Nenhuma TAG lida a tempo. Tente de novo.
          </>
        )}
        {state.status === "error" && (
          <>
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {state.message}
          </>
        )}
      </div>
    </div>
  );
}
