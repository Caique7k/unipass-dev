"use client";

import { UserRound } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader, StatusBadge } from "../components/page-kit";
import { EmptyState, LiveDot, Panel } from "../components/primitives";
import { TripEventList } from "./components/TripEventList";
import { TripStatusCard } from "./components/TripStatusCard";
import { useMyTrip } from "./hooks/useMyTrip";
import type { MyTrip } from "./types/my-trip";

export default function MyTripPage() {
  const { user } = useAuth();
  const canView = user?.role === "USER";
  const { trip, loading, error, refresh } = useMyTrip(canView);

  if (!canView) {
    return (
      <AccessDenied description="Esta página é só para o login do aluno." />
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        eyebrow={user?.companyName ?? undefined}
        title="Minha viagem"
        description={trip?.studentName ?? undefined}
        meta={trip && <RefreshStatus failed={Boolean(error)} />}
      />

      {loading && (
        <>
          <Skeleton className="h-72 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
        </>
      )}

      {!trip && error && (
        <ErrorState message={error} onRetry={() => void refresh()} />
      )}

      {trip && <TripContent trip={trip} />}
    </div>
  );
}

function TripContent({ trip }: { trip: MyTrip }) {
  if (!trip.studentName) {
    return (
      <Panel>
        <EmptyState
          icon={<UserRound size={24} />}
          title="Nenhum aluno vinculado a este login"
          description="Fale com a empresa de transporte para vincular seu cadastro de aluno."
        />
      </Panel>
    );
  }

  return (
    <>
      <TripStatusCard trip={trip} />
      <TripEventList events={trip.events} />
    </>
  );
}

/** Se uma recarga falhar, os dados continuam na tela e só este selo muda. */
function RefreshStatus({ failed }: { failed: boolean }) {
  if (failed) {
    return <StatusBadge tone="warning">Falha ao atualizar</StatusBadge>;
  }

  return (
    <span className="mt-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
      <LiveDot />
      Ao vivo
    </span>
  );
}
