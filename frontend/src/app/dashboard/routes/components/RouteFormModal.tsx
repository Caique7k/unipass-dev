"use client";

import { useEffect, useState } from "react";
import { Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";
import {
  FormField,
  FormModal,
  ModalCancelButton,
  ModalSubmitButton,
  fieldAccentStyle,
  fieldInputClass,
} from "../../components/FormModal";
import { buildApiUrl } from "@/services/api";
import { Route } from "../types/route.types";

const ROUTE_NAME_MAX_LENGTH = 120;
const ROUTE_DESCRIPTION_MAX_LENGTH = 500;

export function RouteModal({
  open,
  onOpenChange,
  route,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  route?: Route | null;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = !!route?.id;
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();

  useEffect(() => {
    if (route) {
      setName(route.name);
      setDescription(route.description || "");
      return;
    }

    setName("");
    setDescription("");
  }, [open, route]);

  async function handleSave() {
    const normalizedName = trimmedName;
    const normalizedDescription = trimmedDescription;

    if (!normalizedName) {
      toast.error("Informe o nome da rota.");
      return;
    }

    if (normalizedName.length > ROUTE_NAME_MAX_LENGTH) {
      toast.error(
        `O nome da rota pode ter no maximo ${ROUTE_NAME_MAX_LENGTH} caracteres.`,
      );
      return;
    }

    if (normalizedDescription.length > ROUTE_DESCRIPTION_MAX_LENGTH) {
      toast.error(
        `A descricao pode ter no maximo ${ROUTE_DESCRIPTION_MAX_LENGTH} caracteres.`,
      );
      return;
    }

    try {
      setIsSaving(true);

      const response = await fetch(
        isEdit ? buildApiUrl(`/routes/${route?.id}`) : buildApiUrl("/routes"),
        {
          method: isEdit ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            name: normalizedName,
            description: normalizedDescription || undefined,
          }),
        },
      );

      const data = (await response.json()) as { message?: string | string[] };

      if (!response.ok) {
        const errorMessage = Array.isArray(data.message)
          ? data.message.join(", ")
          : data.message;
        throw new Error(errorMessage || "Erro ao salvar rota");
      }

      toast.success(
        isEdit ? "Rota atualizada com sucesso." : "Rota criada com sucesso.",
      );

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao salvar rota.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      icon={<RouteIcon size={18} />}
      title={isEdit ? "Editar rota" : "Nova rota"}
      description="A rota é a linha em si. Os horários de ida e volta são cadastrados depois, dentro dela."
      footer={
        <>
          <ModalCancelButton onClick={() => onOpenChange(false)} />
          <ModalSubmitButton onClick={handleSave} busy={isSaving}>
            {isEdit ? "Salvar alterações" : "Criar rota"}
          </ModalSubmitButton>
        </>
      }
    >
      <div className="space-y-5">
        <FormField
          label="Nome da rota"
          required
          hint={`${trimmedName.length}/${ROUTE_NAME_MAX_LENGTH} caracteres`}
          error={
            trimmedName.length > ROUTE_NAME_MAX_LENGTH
              ? `O nome pode ter no máximo ${ROUTE_NAME_MAX_LENGTH} caracteres.`
              : undefined
          }
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Linha Centro → Escola"
            autoComplete="off"
            className={fieldInputClass}
            style={fieldAccentStyle}
          />
        </FormField>

        <FormField
          label="Descrição"
          hint={`Opcional · ${trimmedDescription.length}/${ROUTE_DESCRIPTION_MAX_LENGTH} caracteres`}
          error={
            trimmedDescription.length > ROUTE_DESCRIPTION_MAX_LENGTH
              ? `A descrição pode ter no máximo ${ROUTE_DESCRIPTION_MAX_LENGTH} caracteres.`
              : undefined
          }
        >
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Bairros atendidos, pontos de referência, observações da linha..."
            rows={4}
            className={`${fieldInputClass} h-auto resize-y py-2.5 leading-relaxed`}
            style={fieldAccentStyle}
          />
        </FormField>
      </div>
    </FormModal>
  );
}
