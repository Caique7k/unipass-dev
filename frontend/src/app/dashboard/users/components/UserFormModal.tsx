"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import api from "@/services/api";
import { roleLabels, type UserRole } from "@/lib/permissions";
import type { ManagedUser } from "../types/user";

const companyRoles: UserRole[] = ["ADMIN", "DRIVER", "COORDINATOR", "USER"];

type UserCandidate = {
  id: string;
  name: string;
  email: string | null;
  registration: string;
};

const emptyForm = {
  name: "",
  emailLogin: "",
  password: "",
  role: "USER" as UserRole,
  studentId: "",
};

function extractLoginFromEmail(email?: string | null) {
  if (!email) return "";
  return email.split("@")[0] ?? "";
}

function buildStudentLabel(student: Pick<UserCandidate, "name" | "email">) {
  return student.email ? `${student.name} - ${student.email}` : student.name;
}

function getCurrentStudentCandidate(user?: ManagedUser | null): UserCandidate | null {
  if (!user?.student) {
    return null;
  }

  return {
    id: user.student.id,
    name: user.student.name,
    email: user.student.email ?? user.email,
    registration: user.student.registration,
  };
}

export function UserFormModal({
  open,
  onOpenChange,
  user,
  emailDomain,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: ManagedUser | null;
  emailDomain?: string | null;
  onSuccess: () => Promise<void> | void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidates, setCandidates] = useState<UserCandidate[]>([]);
  const isEdit = !!user?.id;
  const isStudentRole = form.role === "USER";
  const currentStudentCandidate = useMemo(
    () => getCurrentStudentCandidate(user),
    [user],
  );
  const candidateOptions = useMemo(() => {
    if (!currentStudentCandidate) {
      return candidates;
    }

    const existingCandidate = candidates.find(
      (candidate) => candidate.id === currentStudentCandidate.id,
    );

    if (!existingCandidate) {
      return [currentStudentCandidate, ...candidates];
    }

    return candidates.map((candidate) =>
      candidate.id === currentStudentCandidate.id
        ? {
            ...candidate,
            email: candidate.email ?? currentStudentCandidate.email,
          }
        : candidate,
    );
  }, [candidates, currentStudentCandidate]);

  const selectedStudent = useMemo(
    () => candidateOptions.find((candidate) => candidate.id === form.studentId),
    [candidateOptions, form.studentId],
  );
  const studentSelectPlaceholder = loadingCandidates
    ? "Carregando alunos..."
    : "Selecione o aluno pelo e-mail";
  const candidateItems = useMemo(
    () =>
      candidateOptions.map((candidate) => ({
        value: candidate.id,
        label: buildStudentLabel(candidate),
      })),
    [candidateOptions],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm({
      name: user?.name ?? "",
      emailLogin: extractLoginFromEmail(user?.email),
      password: "",
      role: user?.role ?? "USER",
      studentId: user?.studentId ?? "",
    });
  }, [open, user]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function fetchCandidates() {
      try {
        setLoadingCandidates(true);
        const response = await api.get("/students/user-candidates/list", {
          params: user?.id ? { includeUserId: user.id } : {},
        });

        if (!cancelled) {
          setCandidates(response.data ?? []);
        }
      } catch {
        if (!cancelled) {
          setCandidates([]);
          toast.error("Não foi possível carregar os alunos disponíveis.");
        }
      } finally {
        if (!cancelled) {
          setLoadingCandidates(false);
        }
      }
    }

    void fetchCandidates();

    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  const resolvedEmail = useMemo(() => {
    if (isStudentRole && selectedStudent?.email) {
      return selectedStudent.email;
    }

    if (!form.emailLogin.trim()) {
      return emailDomain ? `@${emailDomain}` : "";
    }

    return emailDomain
      ? `${form.emailLogin.trim().toLowerCase()}@${emailDomain}`
      : form.emailLogin.trim().toLowerCase();
  }, [emailDomain, form.emailLogin, isStudentRole, selectedStudent?.email]);

  function validateForm() {
    if (isStudentRole) {
      if (!form.studentId) {
        toast.error("Selecione um aluno para criar o acesso.");
        return false;
      }
    } else {
      if (!form.name.trim() || form.name.trim().length < 3) {
        toast.error("Informe um nome válido com pelo menos 3 caracteres.");
        return false;
      }

      if (!form.emailLogin.trim()) {
        toast.error("Informe o login do e-mail.");
        return false;
      }

      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(form.emailLogin.trim())) {
        toast.error("Use apenas letras, números, ponto, hífen ou underline.");
        return false;
      }
    }

    if (!isEdit && form.password.length < 6) {
      toast.error("A senha inicial precisa ter pelo menos 6 caracteres.");
      return false;
    }

    if (isEdit && form.password && form.password.length < 6) {
      toast.error("A nova senha precisa ter pelo menos 6 caracteres.");
      return false;
    }

    return true;
  }

  async function handleSubmit() {
    if (!validateForm()) {
      return;
    }

    const payload = isStudentRole
      ? {
          role: form.role,
          studentId: form.studentId,
          ...(form.password ? { password: form.password } : {}),
        }
      : {
          name: form.name.trim(),
          email: resolvedEmail,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
        };

    try {
      setSaving(true);

      if (isEdit) {
        await api.patch(`/users/${user?.id}`, payload);
        toast.success("Usuário atualizado com sucesso.");
      } else {
        await api.post("/users", payload);
        toast.success("Usuário criado com sucesso.");
      }

      await onSuccess();
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(
        axios.isAxiosError(error)
          ? error.response?.data?.message ?? "Erro ao salvar usuário."
          : "Erro ao salvar usuário.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden border-0 p-0 shadow-2xl sm:max-w-[620px]">
        <div className="border-b border-[#ff5c00]/10 bg-[#ff5c00]/[0.04] px-6 py-5">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-2xl font-bold text-foreground">
              {isEdit ? "Editar usuário" : "Novo usuário"}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {isEdit
                ? "Atualize os dados de acesso e mantenha o vínculo com a empresa."
                : "Crie acessos com domínio fixo da empresa e, para alunos, use um cadastro já existente."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="unipass-scrollbar min-h-0 space-y-6 overflow-y-auto bg-background px-4 py-4 sm:px-6 sm:py-6">
          <div className="grid gap-4 rounded-2xl border border-border/60 bg-card/70 p-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-[#ff5c00]/8 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff5c00]">
                Acesso
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {isEdit ? "Edição de cadastro" : "Novo cadastro"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {emailDomain
                  ? `Todos os acessos usam o domínio @${emailDomain}.`
                  : "Use um domínio corporativo válido para este usuário."}
              </p>
            </div>

            <div className="rounded-2xl border border-dashed border-border bg-background/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                E-mail final
              </p>
              <p className="mt-2 text-base font-semibold text-foreground break-all">
                {resolvedEmail || "Defina o acesso"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {isStudentRole
                  ? "O acesso do aluno herda nome e e-mail do cadastro do aluno."
                  : "Perfis internos podem usar login manual dentro do domínio da empresa."}
              </p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Perfil</Label>
              <Select
                value={form.role}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    role: value as UserRole,
                    studentId: value === "USER" ? prev.studentId : "",
                  }))
                }
              >
                <SelectTrigger className="h-11 w-full cursor-pointer rounded-xl border-border/70 bg-background px-3">
                  <SelectValue>{roleLabels[form.role]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {companyRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabels[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isStudentRole ? (
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-sm font-medium">Aluno vinculado</Label>
                <Select
                  value={form.studentId}
                  items={candidateItems}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, studentId: value ?? "" }))
                  }
                  disabled={loadingCandidates}
                >
                  <SelectTrigger className="h-11 w-full cursor-pointer rounded-xl border-border/70 bg-background px-3">
                    <SelectValue placeholder={studentSelectPlaceholder}>
                      {(value) => {
                        if (!value) {
                          return studentSelectPlaceholder;
                        }

                        const candidate = candidateOptions.find(
                          (item) => item.id === value,
                        );

                        return candidate
                          ? buildStudentLabel(candidate)
                          : studentSelectPlaceholder;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {candidateOptions.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {buildStudentLabel(candidate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedStudent && (
                  <p className="text-xs text-muted-foreground">
                    Matrícula {selectedStudent.registration}
                    {selectedStudent.email ? ` • ${selectedStudent.email}` : ""}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Nome</Label>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Digite o nome completo"
                    className="h-11 rounded-xl border-border/70 bg-background px-3"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Login do e-mail</Label>
                  <div className="flex min-h-11 items-center rounded-xl border border-border/70 bg-background px-3">
                    <input
                      value={form.emailLogin}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          emailLogin: e.target.value,
                        }))
                      }
                      placeholder="nome.sobrenome"
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
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {isEdit ? "Nova senha" : "Senha"}
            </Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, password: e.target.value }))
              }
              placeholder={
                isEdit
                  ? "Preencha apenas se quiser trocar"
                  : "Mínimo de 6 caracteres"
              }
              className="h-11 rounded-xl border-border/70 bg-background px-3"
            />
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? "Deixe em branco para manter a senha atual."
                : "Use pelo menos 6 caracteres para o primeiro acesso."}
            </p>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-border/60 pt-2 sm:flex-row sm:justify-end">
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className="h-11 w-full cursor-pointer rounded-xl px-6 sm:w-auto"
            >
              {saving
                ? "Salvando..."
                : isEdit
                  ? "Salvar alterações"
                  : "Criar usuário"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
