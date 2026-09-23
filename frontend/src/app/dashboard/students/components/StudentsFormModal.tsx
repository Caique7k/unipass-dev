"use client";

import { useEffect, useMemo, useState } from "react";
import { BookUser } from "lucide-react";
import {
  FormModal,
  ModalCancelButton,
  ModalSubmitButton,
} from "../../components/FormModal";
import { Check, ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { buildApiUrl } from "@/services/api";
import {
  billingRecurrenceLabels,
  type BillingTemplateRecurrence,
} from "@/app/dashboard/billing-groups/types/billing-group";

type GroupOption = {
  id: string;
  name: string;
  active: boolean;
};

type RouteOption = {
  id: string;
  name: string;
  active: boolean;
};

type BillingTemplateOption = {
  id: string;
  name: string;
  active: boolean;
  amountCents: number;
  dueDay: number;
  recurrence: BillingTemplateRecurrence;
};

type BillingCustomerForm = {
  name: string;
  email: string;
  document: string;
  phone: string;
};

type Student = {
  id?: string;
  name?: string;
  registration?: string;
  email?: string | null;
  phone?: string | null;
  active?: boolean;
  groupId?: string | null;
  billingTemplateId?: string | null;
  group?: GroupOption | null;
  billingTemplate?: BillingTemplateOption | null;
  billingCustomer?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    document?: string | null;
    phone?: string | null;
  } | null;
  routeIds?: string[];
  routes?: {
    route: RouteOption;
  }[];
};

type Errors = Partial<
  Record<
    | "name"
    | "registration"
    | "groupId"
    | "billingTemplateId"
    | "routeIds"
    | "emailLocalPart"
    | "phone"
    | "billingCustomerName"
    | "billingCustomerEmail",
    string
  >
>;

const emptyBillingCustomer: BillingCustomerForm = {
  name: "",
  email: "",
  document: "",
  phone: "",
};

const emptyForm: Student = {
  name: "",
  registration: "",
  email: "",
  phone: "",
  groupId: "",
  billingTemplateId: "",
  routeIds: [],
  active: true,
};

function extractEmailLocalPart(email?: string | null) {
  if (!email) return "";
  return email.split("@")[0] ?? "";
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCents / 100);
}

function hasBillingCustomerData(data: BillingCustomerForm) {
  return Object.values(data).some((value) => value.trim().length > 0);
}

function deriveBillingCustomerForm(student?: Student | null): BillingCustomerForm {
  const customer = student?.billingCustomer;

  if (!customer) {
    return emptyBillingCustomer;
  }

  const matchesStudentName =
    !!student?.name && customer.name?.trim() === student.name.trim();
  const matchesStudentEmail =
    !!student?.email &&
    customer.email?.trim().toLowerCase() === student.email.trim().toLowerCase();
  const matchesStudentPhone =
    !!student?.phone && customer.phone?.trim() === student.phone.trim();
  const hasDocument = !!customer.document?.trim();

  if (
    matchesStudentName &&
    matchesStudentEmail &&
    matchesStudentPhone &&
    !hasDocument
  ) {
    return emptyBillingCustomer;
  }

  return {
    name: customer.name ?? "",
    email: customer.email ?? "",
    document: customer.document ?? "",
    phone: customer.phone ?? "",
  };
}

export function StudentModal({
  open,
  onOpenChange,
  student,
  emailDomain,
  groups,
  groupsLoading,
  groupsLoaded,
  routes,
  routesLoading,
  routesLoaded,
  billingTemplates,
  billingTemplatesLoading,
  billingTemplatesLoaded,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student?: Student | null;
  emailDomain?: string | null;
  groups: GroupOption[];
  groupsLoading: boolean;
  groupsLoaded: boolean;
  routes: RouteOption[];
  routesLoading: boolean;
  routesLoaded: boolean;
  billingTemplates: BillingTemplateOption[];
  billingTemplatesLoading: boolean;
  billingTemplatesLoaded: boolean;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<Student>(emptyForm);
  const [emailLocalPart, setEmailLocalPart] = useState("");
  const [billingCustomerForm, setBillingCustomerForm] =
    useState<BillingCustomerForm>(emptyBillingCustomer);
  const [errors, setErrors] = useState<Errors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [rfidTag, setRfidTag] = useState("");
  const [createdStudent, setCreatedStudent] = useState<Student | null>(null);
  const [serverError, setServerError] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [billingTemplateSearch, setBillingTemplateSearch] = useState("");
  const [billingTemplateDropdownOpen, setBillingTemplateDropdownOpen] =
    useState(false);
  const [routeSearch, setRouteSearch] = useState("");
  const [routeDropdownOpen, setRouteDropdownOpen] = useState(false);

  const isEdit = !!student?.id;
  const availableGroups = useMemo(() => {
    const options = new Map<string, GroupOption>();

    groups.forEach((group) => {
      options.set(group.id, group);
    });

    if (student?.group?.id && !options.has(student.group.id)) {
      options.set(student.group.id, student.group);
    }

    return Array.from(options.values());
  }, [groups, student?.group]);
  const availableBillingTemplates = useMemo(() => {
    const options = new Map<string, BillingTemplateOption>();

    billingTemplates.forEach((billingTemplate) => {
      options.set(billingTemplate.id, billingTemplate);
    });

    if (
      student?.billingTemplate?.id &&
      !options.has(student.billingTemplate.id)
    ) {
      options.set(student.billingTemplate.id, student.billingTemplate);
    }

    return Array.from(options.values());
  }, [billingTemplates, student?.billingTemplate]);
  const selectedGroup = useMemo(
    () => availableGroups.find((group) => group.id === form.groupId),
    [availableGroups, form.groupId],
  );
  const selectedBillingTemplate = useMemo(
    () =>
      availableBillingTemplates.find(
        (billingTemplate) => billingTemplate.id === form.billingTemplateId,
      ),
    [availableBillingTemplates, form.billingTemplateId],
  );
  const filteredGroups = useMemo(() => {
    const search = groupSearch.trim().toLowerCase();

    if (!search) {
      return availableGroups;
    }

    return availableGroups.filter((group) =>
      group.name.toLowerCase().includes(search),
    );
  }, [availableGroups, groupSearch]);
  const filteredBillingTemplates = useMemo(() => {
    const search = billingTemplateSearch.trim().toLowerCase();

    if (!search) {
      return availableBillingTemplates;
    }

    return availableBillingTemplates.filter((billingTemplate) =>
      billingTemplate.name.toLowerCase().includes(search),
    );
  }, [availableBillingTemplates, billingTemplateSearch]);
  const availableRoutes = useMemo(() => {
    const options = new Map<string, RouteOption>();

    routes.forEach((route) => {
      options.set(route.id, route);
    });

    student?.routes?.forEach((studentRoute) => {
      options.set(studentRoute.route.id, studentRoute.route);
    });

    return Array.from(options.values());
  }, [routes, student?.routes]);
  const selectedRoutes = useMemo(
    () => availableRoutes.filter((route) => form.routeIds?.includes(route.id)),
    [availableRoutes, form.routeIds],
  );
  const selectedInactiveRoutes = useMemo(
    () => selectedRoutes.filter((route) => !route.active),
    [selectedRoutes],
  );
  const filteredRoutes = useMemo(() => {
    const search = routeSearch.trim().toLowerCase();

    if (!search) {
      return availableRoutes;
    }

    return availableRoutes.filter((route) =>
      route.name.toLowerCase().includes(search),
    );
  }, [availableRoutes, routeSearch]);

  const resolvedEmailPreview = useMemo(() => {
    if (!emailLocalPart.trim()) {
      return emailDomain ? `@${emailDomain}` : "";
    }

    return emailDomain
      ? `${emailLocalPart.trim().toLowerCase()}@${emailDomain}`
      : emailLocalPart.trim().toLowerCase();
  }, [emailDomain, emailLocalPart]);

  useEffect(() => {
    setForm(
      student
        ? {
            ...student,
            routeIds:
              student.routes?.map((studentRoute) => studentRoute.route.id) ??
              [],
          }
        : emptyForm,
    );
    setEmailLocalPart(extractEmailLocalPart(student?.email));
    setBillingCustomerForm(deriveBillingCustomerForm(student));
    setErrors({});
    setServerError("");
    setIsLinking(false);
    setCreatedStudent(null);
    setRfidTag("");
    setGroupSearch("");
    setGroupDropdownOpen(false);
    setBillingTemplateSearch("");
    setBillingTemplateDropdownOpen(false);
    setRouteSearch("");
    setRouteDropdownOpen(false);
  }, [student, open]);

  const handleChange = (
    field: keyof Student,
    value: Student[keyof Student],
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleBillingCustomerChange = (
    field: keyof BillingCustomerForm,
    value: string,
  ) => {
    setBillingCustomerForm((prev) => ({ ...prev, [field]: value }));
  };

  const validate = (): boolean => {
    const newErrors: Errors = {};

    if (!form.name || form.name.length < 3) {
      newErrors.name = "Nome invalido.";
    }

    if (!form.registration || form.registration.length < 3) {
      newErrors.registration = "Matricula invalida.";
    }

    if (!form.groupId) {
      newErrors.groupId = "Selecione um grupo";
    }

    if (!form.billingTemplateId) {
      newErrors.billingTemplateId = "Selecione um grupo de boletos";
    }

    if (!form.routeIds?.length) {
      newErrors.routeIds = "Selecione pelo menos uma rota";
    }

    if (!emailLocalPart.trim()) {
      newErrors.emailLocalPart = "Informe o login do e-mail";
    } else if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(emailLocalPart.trim())) {
      newErrors.emailLocalPart =
        "Use apenas letras, numeros, ponto, hifen ou underline.";
    }

    if (!form.phone || form.phone.replace(/\D/g, "").length < 10) {
      newErrors.phone = "Telefone invalido.";
    }

    if (hasBillingCustomerData(billingCustomerForm)) {
      if (!billingCustomerForm.name.trim()) {
        newErrors.billingCustomerName =
          "Informe o nome do responsavel financeiro.";
      }

      if (
        billingCustomerForm.email.trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingCustomerForm.email.trim())
      ) {
        newErrors.billingCustomerEmail = "Informe um e-mail valido.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const buildPayload = () => ({
    name: form.name?.trim(),
    registration: form.registration?.trim(),
    groupId: form.groupId,
    billingTemplateId: form.billingTemplateId,
    routeIds: form.routeIds ?? [],
    email: emailLocalPart.trim().toLowerCase(),
    phone: form.phone?.trim(),
    active: form.active ?? true,
    billingCustomer: hasBillingCustomerData(billingCustomerForm)
      ? {
          name: billingCustomerForm.name.trim(),
          email: billingCustomerForm.email.trim(),
          document: billingCustomerForm.document.trim(),
          phone: billingCustomerForm.phone.trim(),
        }
      : undefined,
  });

  const createStudent = async () => {
    const res = await fetch(buildApiUrl("/students"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(buildPayload()),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Erro ao criar aluno");
    }

    return data;
  };

  const updateStudent = async () => {
    const res = await fetch(buildApiUrl(`/students/${student?.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(buildPayload()),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Erro na requisicao");
    }
  };

  const handleSubmit = async () => {
    if (!validate()) {
      toast.error("Revise os campos obrigatorios antes de salvar.");
      return;
    }

    try {
      setIsSaving(true);

      if (isEdit) {
        await updateStudent();
        toast.success("Aluno atualizado com sucesso");
        onSuccess();
        onOpenChange(false);
        return;
      }

      const created = await createStudent();
      toast.success("Aluno criado com sucesso");

      setCreatedStudent(created);
      setIsLinking(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Erro ao salvar aluno";
      setServerError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmLink = async () => {
    if (!rfidTag.trim()) {
      toast.error("Informe o codigo RFID para concluir o vinculo.");
      return;
    }

    const studentId = createdStudent?.id ?? student?.id;

    if (!studentId) {
      toast.error("Nao foi possivel identificar o aluno para vincular o RFID.");
      return;
    }

    try {
      const response = await fetch(buildApiUrl("/rfid/link"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          studentId,
          rfidTag: rfidTag.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Erro ao vincular RFID");
      }

      toast.success("RFID vinculado com sucesso");
      onSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao vincular RFID");
    }
  };

  const renderError = (field: keyof Errors) => {
    if (!errors[field]) return null;
    return <p className="text-sm text-red-500">{errors[field]}</p>;
  };

  const isMissingGroups =
    groupsLoaded && !groupsLoading && availableGroups.length === 0;
  const isMissingRoutes =
    routesLoaded && !routesLoading && availableRoutes.length === 0;
  const isMissingBillingTemplates =
    billingTemplatesLoaded &&
    !billingTemplatesLoading &&
    availableBillingTemplates.length === 0;

  const toggleRoute = (routeId: string) => {
    setForm((prev) => {
      const currentRouteIds = prev.routeIds ?? [];

      return {
        ...prev,
        routeIds: currentRouteIds.includes(routeId)
          ? currentRouteIds.filter((currentId) => currentId !== routeId)
          : [...currentRouteIds, routeId],
      };
    });
  };

  const primarySubmitLabel = groupsLoading
    ? "Carregando grupos..."
    : billingTemplatesLoading
      ? "Carregando grupos de boletos..."
      : routesLoading
        ? "Carregando rotas..."
        : isMissingGroups
          ? "Cadastre um grupo primeiro"
          : isMissingBillingTemplates
            ? "Cadastre um grupo de boletos primeiro"
            : isMissingRoutes
              ? "Cadastre uma rota primeiro"
              : isEdit
                ? "Salvar alterações"
                : "Criar e vincular TAG";

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={<BookUser size={18} />}
      title={
        isLinking
          ? "Vincular TAG RFID"
          : isEdit
            ? "Editar aluno"
            : "Novo aluno"
      }
      description={
        isLinking
          ? "Aproxime a TAG do leitor ou digite o código para concluir o vínculo."
          : isEdit
            ? "Atualize os dados cadastrais, financeiros e operacionais deste aluno."
            : "Preencha os dados, escolha o grupo de boletos e vincule a TAG no final."
      }
      footer={
        isLinking ? (
          <ModalSubmitButton onClick={handleConfirmLink}>
            Confirmar vínculo
          </ModalSubmitButton>
        ) : (
          <>
            <ModalCancelButton onClick={() => onOpenChange(false)} />
            <ModalSubmitButton
              onClick={handleSubmit}
              busy={isSaving}
              disabled={
                groupsLoading ||
                isMissingGroups ||
                billingTemplatesLoading ||
                isMissingBillingTemplates ||
                routesLoading ||
                isMissingRoutes
              }
            >
              {primarySubmitLabel}
            </ModalSubmitButton>
          </>
        )
      }
    >
        <div className="space-y-6">
          {!isLinking ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/50 bg-background/50 px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    E-mail institucional
                  </p>
                  <p className="mt-1 break-all text-sm font-medium">
                    {resolvedEmailPreview || "Defina o login do aluno"}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/50 bg-background/50 px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Grupo de boletos
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {selectedBillingTemplate?.name || "Nenhum selecionado"}
                  </p>
                  {selectedBillingTemplate && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatCurrency(selectedBillingTemplate.amountCents)} · dia{" "}
                      {selectedBillingTemplate.dueDay} ·{" "}
                      {billingRecurrenceLabels[selectedBillingTemplate.recurrence]}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">Nome</Label>
                  <Input
                    value={form.name || ""}
                    onChange={(e) => handleChange("name", e.target.value)}
                    className={cn(
                      "h-11 rounded-xl border-border/70 bg-background px-3",
                      errors.name && "border-red-500",
                    )}
                    placeholder="Digite o nome completo"
                  />
                  {renderError("name")}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Matricula</Label>
                  <Input
                    value={form.registration || ""}
                    onChange={(e) =>
                      handleChange("registration", e.target.value)
                    }
                    className={cn(
                      "h-11 rounded-xl border-border/70 bg-background px-3",
                      errors.registration && "border-red-500",
                    )}
                    placeholder="Informe a matricula"
                  />
                  {renderError("registration")}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Grupo</Label>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-11 w-full justify-between rounded-xl border-border/70 bg-background px-3",
                        errors.groupId && "border-red-500",
                      )}
                      disabled={groupsLoading || isMissingGroups}
                      onClick={() => setGroupDropdownOpen((prev) => !prev)}
                    >
                      <span className="truncate">
                        {groupsLoading
                          ? "Carregando grupos..."
                          : selectedGroup
                            ? `${selectedGroup.name}${!selectedGroup.active ? " (inativo)" : ""}`
                            : isMissingGroups
                              ? "Cadastre um grupo primeiro"
                              : "Selecione um grupo"}
                      </span>
                      <ChevronsUpDown className="size-4 opacity-60" />
                    </Button>

                    {groupDropdownOpen &&
                      !groupsLoading &&
                      !isMissingGroups && (
                        <div className="absolute z-50 mt-2 w-full rounded-xl border border-border/60 bg-background p-2 shadow-md">
                          <Input
                            placeholder="Buscar grupo..."
                            value={groupSearch}
                            onChange={(e) => setGroupSearch(e.target.value)}
                            className="h-10 rounded-lg"
                          />

                          <div className="mt-2 max-h-56 overflow-y-auto">
                            {filteredGroups.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                Nenhum grupo encontrado.
                              </div>
                            ) : (
                              filteredGroups.map((group) => (
                                <button
                                  key={group.id}
                                  type="button"
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                                  onClick={() => {
                                    handleChange("groupId", group.id);
                                    setGroupDropdownOpen(false);
                                    setGroupSearch("");
                                  }}
                                >
                                  <span>
                                    {group.name}
                                    {!group.active ? " (inativo)" : ""}
                                  </span>
                                  <Check
                                    className={cn(
                                      "size-4",
                                      group.id === form.groupId
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                  {isMissingGroups ? (
                    <p className="text-sm text-amber-600">
                      Antes de cadastrar um aluno, e preciso cadastrar um grupo.
                    </p>
                  ) : null}
                  {selectedGroup && !selectedGroup.active ? (
                    <p className="text-sm text-amber-600">
                      Este aluno esta vinculado a um grupo inativo. Para trocar,
                      selecione um grupo ativo.
                    </p>
                  ) : null}
                  {renderError("groupId")}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">
                    Grupo de boletos
                  </Label>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-11 w-full justify-between rounded-xl border-border/70 bg-background px-3",
                        errors.billingTemplateId && "border-red-500",
                      )}
                      disabled={
                        billingTemplatesLoading || isMissingBillingTemplates
                      }
                      onClick={() =>
                        setBillingTemplateDropdownOpen((prev) => !prev)
                      }
                    >
                      <span className="truncate">
                        {billingTemplatesLoading
                          ? "Carregando grupos de boletos..."
                          : selectedBillingTemplate
                            ? `${selectedBillingTemplate.name}${!selectedBillingTemplate.active ? " (inativo)" : ""}`
                            : isMissingBillingTemplates
                              ? "Cadastre um grupo de boletos primeiro"
                              : "Selecione um grupo de boletos"}
                      </span>
                      <ChevronsUpDown className="size-4 opacity-60" />
                    </Button>

                    {billingTemplateDropdownOpen &&
                      !billingTemplatesLoading &&
                      !isMissingBillingTemplates && (
                        <div className="absolute z-50 mt-2 w-full rounded-xl border border-border/60 bg-background p-2 shadow-md">
                          <Input
                            placeholder="Buscar grupo de boletos..."
                            value={billingTemplateSearch}
                            onChange={(e) =>
                              setBillingTemplateSearch(e.target.value)
                            }
                            className="h-10 rounded-lg"
                          />

                          <div className="mt-2 max-h-56 overflow-y-auto">
                            {filteredBillingTemplates.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                Nenhum grupo de boletos encontrado.
                              </div>
                            ) : (
                              filteredBillingTemplates.map((billingTemplate) => (
                                <button
                                  key={billingTemplate.id}
                                  type="button"
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                                  onClick={() => {
                                    handleChange(
                                      "billingTemplateId",
                                      billingTemplate.id,
                                    );
                                    setBillingTemplateDropdownOpen(false);
                                    setBillingTemplateSearch("");
                                  }}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate">
                                      {billingTemplate.name}
                                      {!billingTemplate.active
                                        ? " (inativo)"
                                        : ""}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                      {formatCurrency(
                                        billingTemplate.amountCents,
                                      )}{" "}
                                      • dia {billingTemplate.dueDay} •{" "}
                                      {
                                        billingRecurrenceLabels[
                                          billingTemplate.recurrence
                                        ]
                                      }
                                    </span>
                                  </span>
                                  <Check
                                    className={cn(
                                      "size-4 shrink-0",
                                      billingTemplate.id ===
                                        form.billingTemplateId
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                  {selectedBillingTemplate ? (
                    <div className="rounded-2xl border border-border/60 bg-card/60 p-4 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">
                        {selectedBillingTemplate.name}
                      </p>
                      <p className="mt-1">
                        Valor:{" "}
                        {formatCurrency(selectedBillingTemplate.amountCents)} •
                        vencimento no dia {selectedBillingTemplate.dueDay} •{" "}
                        {
                          billingRecurrenceLabels[
                            selectedBillingTemplate.recurrence
                          ]
                        }
                      </p>
                    </div>
                  ) : null}
                  {isMissingBillingTemplates ? (
                    <p className="text-sm text-amber-600">
                      Antes de cadastrar um aluno, e preciso cadastrar um grupo
                      de boletos.
                    </p>
                  ) : null}
                  {selectedBillingTemplate && !selectedBillingTemplate.active ? (
                    <p className="text-sm text-amber-600">
                      Este aluno esta vinculado a um grupo de boletos inativo.
                      Para trocar, selecione um grupo ativo.
                    </p>
                  ) : null}
                  {renderError("billingTemplateId")}
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">Rotas</Label>
                  <div className="relative">
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-11 w-full justify-between rounded-xl border-border/70 bg-background px-3",
                        errors.routeIds && "border-red-500",
                      )}
                      disabled={routesLoading || isMissingRoutes}
                      onClick={() => setRouteDropdownOpen((prev) => !prev)}
                    >
                      <span className="truncate">
                        {routesLoading
                          ? "Carregando rotas..."
                          : selectedRoutes.length === 0
                            ? isMissingRoutes
                              ? "Cadastre uma rota primeiro"
                              : "Selecione as rotas"
                            : selectedRoutes.length === 1
                              ? selectedRoutes[0].name
                              : `${selectedRoutes.length} rotas selecionadas`}
                      </span>
                      <ChevronsUpDown className="size-4 opacity-60" />
                    </Button>

                    {routeDropdownOpen &&
                      !routesLoading &&
                      !isMissingRoutes && (
                        <div className="absolute z-50 mt-2 w-full rounded-xl border border-border/60 bg-background p-2 shadow-md">
                          <Input
                            placeholder="Buscar rota..."
                            value={routeSearch}
                            onChange={(e) => setRouteSearch(e.target.value)}
                            className="h-10 rounded-lg"
                          />

                          <div className="mt-2 max-h-56 overflow-y-auto">
                            {filteredRoutes.length === 0 ? (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                Nenhuma rota encontrada.
                              </div>
                            ) : (
                              filteredRoutes.map((route) => (
                                <button
                                  key={route.id}
                                  type="button"
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                                  onClick={() => toggleRoute(route.id)}
                                >
                                  <span>
                                    {route.name}
                                    {!route.active ? " (inativa)" : ""}
                                  </span>
                                  <Check
                                    className={cn(
                                      "size-4",
                                      form.routeIds?.includes(route.id)
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                  {selectedRoutes.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedRoutes.map((route) => (
                        <span
                          key={route.id}
                          className="rounded-full bg-muted px-3 py-1 text-xs text-foreground"
                        >
                          {route.name}
                          {!route.active ? " (inativa)" : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {selectedInactiveRoutes.length > 0 ? (
                    <p className="text-sm text-amber-600">
                      Este aluno ainda possui rota(s) inativa(s) vinculada(s).
                      Voce pode salvar normalmente ou remover essas rotas se
                      quiser limpar o cadastro.
                    </p>
                  ) : null}
                  {isMissingRoutes ? (
                    <p className="text-sm text-amber-600">
                      Antes de definir notificacoes, e preciso cadastrar pelo
                      menos uma rota.
                    </p>
                  ) : null}
                  {renderError("routeIds")}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Login do e-mail</Label>
                  <div
                    className={cn(
                      "flex min-h-11 items-center rounded-xl border border-border/70 bg-background px-3",
                      errors.emailLocalPart && "border-red-500",
                    )}
                  >
                    <input
                      value={emailLocalPart}
                      onChange={(e) => setEmailLocalPart(e.target.value)}
                      placeholder="caique.alves"
                      className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                    {emailDomain && (
                      <span
                        className="max-w-[48%] shrink-0 truncate pl-3 text-sm text-muted-foreground sm:max-w-[55%]"
                        title={`@${emailDomain}`}
                      >
                        @{emailDomain}
                      </span>
                    )}
                  </div>
                  {renderError("emailLocalPart")}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Telefone</Label>
                  <Input
                    value={form.phone || ""}
                    onChange={(e) => handleChange("phone", e.target.value)}
                    className={cn(
                      "h-11 rounded-xl border-border/70 bg-background px-3",
                      errors.phone && "border-red-500",
                    )}
                    placeholder="(00) 00000-0000"
                  />
                  {renderError("phone")}
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-border/60 bg-card/60 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    Responsavel financeiro
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Se voce deixar em branco, o proprio aluno sera usado como
                    pagador padrao na geracao dos boletos.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Nome do responsavel
                    </Label>
                    <Input
                      value={billingCustomerForm.name}
                      onChange={(e) =>
                        handleBillingCustomerChange("name", e.target.value)
                      }
                      className={cn(
                        "h-11 rounded-xl border-border/70 bg-background px-3",
                        errors.billingCustomerName && "border-red-500",
                      )}
                      placeholder="Ex.: Maria da Silva"
                    />
                    {renderError("billingCustomerName")}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      E-mail do responsavel
                    </Label>
                    <Input
                      value={billingCustomerForm.email}
                      onChange={(e) =>
                        handleBillingCustomerChange("email", e.target.value)
                      }
                      className={cn(
                        "h-11 rounded-xl border-border/70 bg-background px-3",
                        errors.billingCustomerEmail && "border-red-500",
                      )}
                      placeholder="financeiro@familia.com"
                    />
                    {renderError("billingCustomerEmail")}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      CPF/CNPJ do responsavel
                    </Label>
                    <Input
                      value={billingCustomerForm.document}
                      onChange={(e) =>
                        handleBillingCustomerChange("document", e.target.value)
                      }
                      className="h-11 rounded-xl border-border/70 bg-background px-3"
                      placeholder="Somente numeros"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Telefone do responsavel
                    </Label>
                    <Input
                      value={billingCustomerForm.phone}
                      onChange={(e) =>
                        handleBillingCustomerChange("phone", e.target.value)
                      }
                      className="h-11 rounded-xl border-border/70 bg-background px-3"
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
              </div>

              {serverError && (
                <p className="text-sm text-red-500">{serverError}</p>
              )}

            </>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 rounded-2xl border border-border/60 bg-card/70 p-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-[#ff5c00]/8 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff5c00]">
                    Vínculo
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    Cartao do aluno
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Aproxime a TAG do leitor ou informe o código manualmente.
                  </p>
                </div>

                <div className="rounded-2xl border border-dashed border-border bg-background/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Aluno criado
                  </p>
                  <p className="mt-2 text-base font-semibold text-foreground">
                    {createdStudent?.name || "Cadastro concluido"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Finalize o processo confirmando o identificador RFID.
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-center">
                <p className="text-sm font-medium text-foreground">
                  Aproxime a TAG do leitor ou digite o código abaixo.
                </p>

                <Input
                  placeholder="Código da TAG"
                  value={rfidTag}
                  onChange={(e) => setRfidTag(e.target.value)}
                  className="h-11 rounded-xl border-border/70 bg-background px-3"
                />
              </div>

            </div>
          )}
        </div>
    </FormModal>
  );
}
