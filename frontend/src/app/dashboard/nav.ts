import {
  BookUser,
  Building2,
  ClipboardList,
  Compass,
  FileBarChart2,
  FileText,
  Home,
  Layers3,
  Route,
  Smartphone,
  SmartphoneNfc,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { hasRole, type UserRole } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Palavras extras que a busca do painel também aceita. */
  keywords?: string[];
  /** Marca o item como ativo também nas subrotas (ex.: /routes/[id]). */
  matchNested?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

/**
 * Monta a navegação já filtrada pelo papel do usuário.
 * As regras de visibilidade são as mesmas que a sidebar aplicava antes.
 */
export function buildNavGroups(role: UserRole | undefined): NavGroup[] {
  const canManageCompany = hasRole(role, ["ADMIN"]);
  const canViewOperations = hasRole(role, ["ADMIN", "DRIVER", "COORDINATOR"]);
  const isPlatformAdmin = hasRole(role, ["PLATFORM_ADMIN"]);

  const groups: NavGroup[] = [
    {
      id: "principal",
      label: "Principal",
      items: isPlatformAdmin
        ? [
            {
              href: "/dashboard/companies",
              label: "Empresas",
              icon: Home,
              keywords: ["clientes", "tenants"],
            },
          ]
        : [
            {
              href: "/dashboard",
              label: "Visão geral",
              icon: Home,
              keywords: ["dashboard", "início", "home"],
            },
          ],
    },
    {
      id: "aplicativo",
      label: "Aplicativo",
      items: [
        {
          href: "/dashboard/app",
          label: "Aplicativo",
          icon: Smartphone,
          keywords: ["push", "notificações", "mobile"],
        },
      ],
    },
  ];

  if (!isPlatformAdmin) {
    groups.push({
      id: "financeiro",
      label: "Financeiro",
      items: [
        ...(canViewOperations
          ? [
              {
                href: "/dashboard/billing-groups",
                label: "Grupos de boletos",
                icon: FileText,
                keywords: ["templates", "mensalidade", "cobrança"],
              },
            ]
          : []),
        {
          href: "/dashboard/billing",
          label: "Boletos",
          icon: Wallet,
          keywords: ["cobranças", "pagamento", "asaas"],
        },
      ],
    });
  }

  if (canViewOperations) {
    groups.push({
      id: "operacao",
      label: "Operação",
      items: [
        {
          href: "/dashboard/location",
          label: "Localização",
          icon: Compass,
          keywords: ["mapa", "gps", "rastreamento", "ao vivo"],
        },
        {
          href: "/dashboard/boarding",
          label: "Embarques",
          icon: ClipboardList,
          keywords: ["retorno", "tag", "rfid", "presença"],
        },
        {
          href: "/dashboard/routes",
          label: "Rotas",
          icon: Route,
          matchNested: true,
          keywords: ["linhas", "horários", "itinerário"],
        },
        {
          href: "/dashboard/buses",
          label: "Ônibus",
          icon: Truck,
          keywords: ["frota", "veículos", "placa"],
        },
        ...(canManageCompany
          ? [
              {
                href: "/dashboard/devices",
                label: "UniHub",
                icon: SmartphoneNfc,
                keywords: ["dispositivo", "pareamento", "iot", "esp32"],
              },
            ]
          : []),
      ],
    });

    groups.push({
      id: "pessoas",
      label: "Pessoas",
      items: [
        {
          href: "/dashboard/students",
          label: "Alunos",
          icon: BookUser,
          keywords: ["estudantes", "passageiros", "matrícula"],
        },
        {
          href: "/dashboard/groups",
          label: "Grupos",
          icon: Layers3,
          keywords: ["turmas"],
        },
      ],
    });
  }

  if (canManageCompany) {
    groups.push({
      id: "administracao",
      label: "Administração",
      items: [
        {
          href: "/dashboard/company",
          label: "Empresa",
          icon: Building2,
          keywords: ["plano", "cnpj", "domínio"],
        },
        {
          href: "/dashboard/users",
          label: "Usuários",
          icon: Users,
          keywords: ["equipe", "staff", "permissões"],
        },
        {
          href: "/dashboard/reports",
          label: "Relatórios",
          icon: FileBarChart2,
          keywords: ["exportar", "métricas", "frequência"],
        },
      ],
    });
  }

  return groups.filter((group) => group.items.length > 0);
}

export function isItemActive(item: NavItem, pathname: string) {
  if (pathname === item.href) return true;

  return Boolean(item.matchNested && pathname.startsWith(`${item.href}/`));
}

export function findActiveItem(groups: NavGroup[], pathname: string) {
  for (const group of groups) {
    for (const item of group.items) {
      if (isItemActive(item, pathname)) {
        return { group, item };
      }
    }
  }

  return null;
}
