"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function DashboardShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-72 shrink-0 border-r border-border/60 bg-card/70 px-4 py-5 lg:block">
        <div className="space-y-5">
          <Skeleton className="h-10 w-40 rounded-2xl" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-16 rounded-full" />
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full rounded-2xl" />
            ))}
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <div className="border-b border-border/60 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-10 w-44 rounded-2xl" />
            <Skeleton className="h-10 w-28 rounded-2xl" />
          </div>
        </div>

        <div className="space-y-6 p-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56 rounded-xl" />
            <Skeleton className="h-4 w-80 rounded-xl" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-32 rounded-[24px]" />
            ))}
          </div>

          <Skeleton className="h-[360px] rounded-[28px]" />
        </div>
      </div>
    </div>
  );
}

export function PageTableSkeleton({
  showAction = true,
  compact = false,
}: {
  showAction?: boolean;
  compact?: boolean;
}) {
  const rows = compact ? 5 : 7;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40 rounded-xl" />
        <Skeleton className="h-4 w-72 rounded-xl" />
      </div>

      <div className="flex flex-col gap-4 rounded-[24px] border border-border/60 bg-card/70 p-4 md:flex-row md:items-center md:justify-between">
        <Skeleton className="h-11 w-full max-w-sm rounded-2xl" />
        {showAction && <Skeleton className="h-11 w-40 rounded-2xl" />}
      </div>

      <div className="rounded-[24px] border border-border/60 bg-card/70 p-4">
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 rounded-xl" />
            ))}
          </div>
          {Array.from({ length: rows }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CompaniesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 rounded-xl" />
        <Skeleton className="h-4 w-64 rounded-xl" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="rounded-[24px] border border-border/60 bg-card/70 p-5"
          >
            <div className="space-y-3">
              <Skeleton className="h-6 w-40 rounded-xl" />
              <Skeleton className="h-4 w-28 rounded-xl" />
              <Skeleton className="h-4 w-36 rounded-xl" />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, statIndex) => (
                <div key={statIndex} className="space-y-2">
                  <Skeleton className="h-3 w-16 rounded-xl" />
                  <Skeleton className="h-5 w-10 rounded-xl" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LocationPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40 rounded-xl" />
          <Skeleton className="h-4 w-[28rem] max-w-full rounded-xl" />
        </div>
        <Skeleton className="h-10 w-40 rounded-2xl" />
      </div>

      <div className="space-y-4 rounded-[24px] border border-border/60 bg-card/70 p-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr]">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32 rounded-full" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>

      <Skeleton className="min-h-[560px] rounded-[30px]" />
    </div>
  );
}

export function DashboardContentSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-[220px] rounded-3xl" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[148px] rounded-3xl" />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[320px] rounded-3xl lg:col-span-2" />
        <Skeleton className="h-[320px] rounded-3xl" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[360px] rounded-3xl" />
        ))}
      </div>

      <Skeleton className="h-[220px] rounded-3xl" />
    </div>
  );
}
