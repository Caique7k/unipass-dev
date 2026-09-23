import type { UserRole } from "@/lib/permissions";

export type UserStatusFilter = "Todos" | "Ativos" | "Inativos";

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  studentId?: string | null;
  student?: {
    id: string;
    name: string;
    email?: string | null;
    registration: string;
    active: boolean;
  } | null;
  createdAt: string;
};
