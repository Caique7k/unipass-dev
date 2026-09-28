"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildApiUrl } from "@/services/api";

export type CaptureDevice = {
  id: string;
  name: string | null;
  code: string | null;
  bus: { plate: string } | null;
};

export type CaptureState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "waiting"; expiresAt: number }
  | {
      status: "captured";
      tag: string;
      alreadyRegistered: boolean;
      linkedStudentName: string | null;
    }
  | { status: "expired" }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 1000;
const LAST_DEVICE_KEY = "unipass:rfid-capture-device";

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as { message?: string }).message ??
        "Não foi possível falar com o servidor.",
    );
  }

  return data;
}

function readLastDevice() {
  try {
    return window.localStorage.getItem(LAST_DEVICE_KEY);
  } catch {
    return null;
  }
}

function saveLastDevice(id: string) {
  try {
    window.localStorage.setItem(LAST_DEVICE_KEY, id);
  } catch {
    // preferência de conveniência — sem storage, só não lembra o UniHub
  }
}

/**
 * "Ler TAG no UniHub": abre uma captura de 60 s no backend e consulta a cada
 * 1 s até o UniHub escolhido ler uma TAG. Fechar o modal ou desmontar cancela
 * a captura, para o UniHub voltar a registrar embarques imediatamente.
 */
export function useRfidCapture(enabled: boolean) {
  const [devices, setDevices] = useState<CaptureDevice[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [deviceId, setDeviceIdState] = useState("");
  const [state, setState] = useState<CaptureState>({ status: "idle" });
  const sessionRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    stopPolling();
    const sessionId = sessionRef.current;
    sessionRef.current = null;

    if (sessionId) {
      void fetch(buildApiUrl(`/rfid/capture/${sessionId}`), {
        method: "DELETE",
        credentials: "include",
        keepalive: true,
      }).catch(() => undefined);
    }
  }, [stopPolling]);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      page: "1",
      limit: "100",
      active: "true",
    });

    fetch(`${buildApiUrl("/devices")}?${params.toString()}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(readJson)
      .then((json: { data?: CaptureDevice[] }) => {
        // Só UniHubs que concluíram o pareamento conseguem ler TAG.
        const paired = (json.data ?? []).filter((device) => device.code);
        setDevices(paired);

        const remembered = readLastDevice();
        const initial =
          paired.find((device) => device.id === remembered) ?? paired[0];
        setDeviceIdState(initial?.id ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted) setDevices([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDevicesLoaded(true);
      });

    return () => controller.abort();
  }, [enabled]);

  // Modal fechando: libera o UniHub na hora. O painel é desmontado junto,
  // então o estado visual recomeça do zero na próxima abertura.
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled, cancel]);

  useEffect(() => cancel, [cancel]);

  const poll = useCallback((sessionId: string) => {
    const tick = async () => {
      if (sessionRef.current !== sessionId) return;

      try {
        const data = await fetch(buildApiUrl(`/rfid/capture/${sessionId}`), {
          credentials: "include",
        }).then(readJson);

        if (sessionRef.current !== sessionId) return;

        if (data.status === "CAPTURED") {
          sessionRef.current = null;
          setState({
            status: "captured",
            tag: data.tag,
            alreadyRegistered: Boolean(data.alreadyRegistered),
            linkedStudentName: data.linkedStudentName ?? null,
          });
          return;
        }

        if (data.status !== "PENDING") {
          sessionRef.current = null;
          setState({ status: "expired" });
          return;
        }

        timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
      } catch (error) {
        if (sessionRef.current !== sessionId) return;
        sessionRef.current = null;
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Falha ao ler a TAG.",
        });
      }
    };

    timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
  }, []);

  const start = useCallback(async () => {
    if (!deviceId) return;

    cancel();
    setState({ status: "starting" });

    try {
      const data = await fetch(buildApiUrl("/rfid/capture"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deviceId }),
      }).then(readJson);

      sessionRef.current = data.id;
      setState({
        status: "waiting",
        expiresAt: new Date(data.expiresAt).getTime(),
      });
      poll(data.id);
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Falha ao iniciar leitura.",
      });
    }
  }, [cancel, deviceId, poll]);

  const setDeviceId = useCallback((id: string) => {
    setDeviceIdState(id);
    saveLastDevice(id);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState({ status: "idle" });
  }, [cancel]);

  return {
    devices,
    devicesLoading: enabled && !devicesLoaded,
    deviceId,
    setDeviceId,
    state,
    start,
    cancel: reset,
  };
}
