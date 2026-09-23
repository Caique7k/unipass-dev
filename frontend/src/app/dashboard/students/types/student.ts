import type { BillingTemplateRecurrence } from "../../billing-groups/types/billing-group";

export type Student = {
  id: string;
  name: string;
  registration: string;
  email?: string | null;
  phone?: string | null;
  active: boolean;
  companyId?: string;
  createdAt?: string;
  groupId?: string | null;
  billingTemplateId?: string | null;
  group?: {
    id: string;
    name: string;
    active: boolean;
  } | null;
  billingTemplate?: {
    id: string;
    name: string;
    active: boolean;
    amountCents: number;
    dueDay: number;
    recurrence: BillingTemplateRecurrence;
  } | null;
  billingCustomer?: {
    id: string;
    name: string;
    email?: string | null;
    document?: string | null;
    phone?: string | null;
  } | null;
  routes?: {
    route: {
      id: string;
      name: string;
      active: boolean;
    };
  }[];
  rfidCards?: {
    tag: string;
  }[];
};
