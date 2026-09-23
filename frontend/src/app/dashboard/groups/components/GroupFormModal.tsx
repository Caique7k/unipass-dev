"use client";

import { useEffect, useState } from "react";
import { Layers3 } from "lucide-react";
import { toast } from "sonner";
import { buildApiUrl } from "@/services/api";
import type { Group } from "../types/group";
import {
  FormField,
  FormModal,
  ModalCancelButton,
  ModalSubmitButton,
  fieldAccentStyle,
  fieldInputClass,
} from "../../components/FormModal";

export function GroupFormModal({
  open,
  onOpenChange,
  group,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: Group | null;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = !!group?.id;

  useEffect(() => {
    setName(group?.name ?? "");
  }, [group, open]);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Informe o nome do grupo.");
      return;
    }

    try {
      setIsSaving(true);

      const response = await fetch(
        isEdit ? buildApiUrl(`/groups/${group?.id}`) : buildApiUrl("/groups"),
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Erro ao salvar grupo");
      }

      toast.success(
        isEdit ? "Grupo atualizado com sucesso." : "Grupo criado com sucesso.",
      );

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar grupo.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      icon={<Layers3 size={18} />}
      title={isEdit ? "Editar grupo" : "Novo grupo"}
      description="Grupos organizam os alunos em turmas para relatórios e agrupamento visual."
      footer={
        <>
          <ModalCancelButton onClick={() => onOpenChange(false)} />
          <ModalSubmitButton onClick={handleSubmit} busy={isSaving}>
            {isEdit ? "Salvar alterações" : "Criar grupo"}
          </ModalSubmitButton>
        </>
      }
    >
      <FormField
        label="Nome do grupo"
        required
        hint="Ex.: Turma da Manhã, Turno A, Faculdade."
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSubmit();
          }}
          placeholder="Digite o nome do grupo"
          autoComplete="off"
          className={fieldInputClass}
          style={fieldAccentStyle}
        />
      </FormField>
    </FormModal>
  );
}
