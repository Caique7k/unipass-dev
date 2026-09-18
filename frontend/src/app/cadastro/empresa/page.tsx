"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  Field,
  FieldMessage,
  Spinner,
  fieldBorderClass,
  fieldErrorBorderClass,
  fieldInputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/auth/fields";
import { cn } from "@/lib/utils";
import api from "@/services/api";

const steps = [
  { id: 1, label: "Empresa", hint: "Identidade e domínio" },
  { id: 2, label: "Verificação", hint: "Código por SMS" },
  { id: 3, label: "Plano", hint: "Ritmo da implantação" },
  { id: 4, label: "Acesso", hint: "Primeiro administrador" },
];

const plans = [
  {
    id: "ESSENTIAL",
    name: "Essential",
    price: "R$ 249",
    period: "/mês",
    description: "Para operações iniciando com visibilidade e cadastros centralizados.",
    features: ["Painel operacional", "Domínio da empresa", "Usuários e alunos"],
  },
  {
    id: "GROWTH",
    name: "Growth",
    price: "R$ 499",
    period: "/mês",
    description: "Para operações que já precisam de ritmo, dispositivos e time maior.",
    features: ["Tudo do Essential", "Mais dispositivos", "Mais coordenação"],
  },
  {
    id: "SCALE",
    name: "Scale",
    price: "Sob consulta",
    period: "",
    description: "Para empresas com múltiplas frentes e rollout mais robusto.",
    features: ["Suporte prioritário", "Implantação assistida", "Escala institucional"],
  },
];

type DomainState = {
  available: boolean;
  normalizedDomain: string;
  suggestions: string[];
  message?: string;
} | null;

type FormErrors = Partial<
  Record<
    | "companyName"
    | "contactName"
    | "phone"
    | "cnpj"
    | "domain"
    | "adminName"
    | "adminLogin"
    | "password"
    | "confirmPassword"
    | "smsCode",
    string
  >
>;

function getErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
  ) {
    return error.response.data.message;
  }

  return fallback;
}

const stepMotion = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] as const },
};

export default function CompanyOnboardingPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [domainState, setDomainState] = useState<DomainState>(null);
  const [smsCode, setSmsCode] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [smsVerified, setSmsVerified] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [verifyingSms, setVerifyingSms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState<{ loginEmail: string; plan: string } | null>(
    null,
  );
  const [developmentSmsCode, setDevelopmentSmsCode] = useState("");
  const [form, setForm] = useState({
    companyName: "",
    contactName: "",
    phone: "",
    cnpj: "",
    domain: "",
    plan: "GROWTH",
    adminName: "",
    adminLogin: "",
    password: "",
    confirmPassword: "",
  });

  const selectedPlan = plans.find((plan) => plan.id === form.plan) ?? plans[1];
  const normalizedDomainPreview =
    domainState?.normalizedDomain ?? form.domain.replace(/^@+/, "");
  const adminEmailPreview = useMemo(() => {
    if (!form.adminLogin.trim()) {
      return normalizedDomainPreview ? `@${normalizedDomainPreview}` : "";
    }

    return normalizedDomainPreview
      ? `${form.adminLogin.trim().toLowerCase()}@${normalizedDomainPreview}`
      : form.adminLogin.trim().toLowerCase();
  }, [form.adminLogin, normalizedDomainPreview]);

  function setFieldError(key: keyof FormErrors, value?: string) {
    setErrors((prev) => ({ ...prev, [key]: value }));
  }

  function updateField<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key in errors) setFieldError(key as keyof FormErrors);
  }

  function validateStepOne() {
    const nextErrors: FormErrors = {};

    if (form.companyName.trim().length < 3) nextErrors.companyName = "Informe o nome da empresa.";
    if (form.contactName.trim().length < 3) nextErrors.contactName = "Informe o responsável.";
    if (form.phone.replace(/\D/g, "").length < 10) nextErrors.phone = "Digite um celular válido com DDD.";
    if (form.cnpj.replace(/\D/g, "").length !== 14) nextErrors.cnpj = "Digite um CNPJ com 14 números.";
    if (!form.domain.trim()) nextErrors.domain = "Defina um domínio para a empresa.";

    setErrors((prev) => ({ ...prev, ...nextErrors }));
    return Object.keys(nextErrors).length === 0;
  }

  function validateStepTwo() {
    if (!smsSent) {
      setFieldError("smsCode", "Envie o SMS antes de confirmar.");
      return false;
    }
    if (smsCode.trim().length !== 6) {
      setFieldError("smsCode", "Digite o código de 6 dígitos.");
      return false;
    }
    setFieldError("smsCode");
    return true;
  }

  function validateStepFour() {
    const nextErrors: FormErrors = {};

    if (form.adminName.trim().length < 3) nextErrors.adminName = "Informe o nome do administrador.";
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(form.adminLogin.trim())) nextErrors.adminLogin = "Use letras, números, ponto, hífen ou underline.";
    if (form.password.length < 6) nextErrors.password = "A senha precisa ter pelo menos 6 caracteres.";
    if (form.confirmPassword !== form.password) nextErrors.confirmPassword = "As senhas não conferem.";

    setErrors((prev) => ({ ...prev, ...nextErrors }));
    return Object.keys(nextErrors).length === 0;
  }

  async function handleCheckDomain(nextDomain?: string) {
    const domain = (nextDomain ?? form.domain).trim();

    if (!domain) {
      setFieldError("domain", "Defina um domínio para a empresa.");
      toast.error("Informe um domínio para validar.");
      return false;
    }

    try {
      setCheckingDomain(true);
      const response = await api.post("/companies/domain-check", { domain });
      setDomainState(response.data);
      setForm((prev) => ({ ...prev, domain: response.data.normalizedDomain }));
      setFieldError("domain");

      if (!response.data.available) {
        setFieldError("domain", response.data.message ?? "Este domínio já está em uso.");
        toast.error(response.data.message ?? "Este domínio já está em uso.");
        return false;
      }

      toast.success("Domínio disponível.");
      return true;
    } catch (error: unknown) {
      setDomainState(null);
      setFieldError("domain", getErrorMessage(error, "Não foi possível validar o domínio."));
      toast.error(getErrorMessage(error, "Não foi possível validar o domínio."));
      return false;
    } finally {
      setCheckingDomain(false);
    }
  }

  async function handleSendSms() {
    if (!validateStepOne()) {
      toast.error("Revise os dados da empresa antes de enviar o SMS.");
      return;
    }

    if (!form.phone.trim()) {
      setFieldError("phone", "Informe o celular da empresa.");
      toast.error("Informe o celular da empresa.");
      return;
    }

    try {
      setSendingSms(true);
      const response = await api.post("/companies/onboarding/sms/send", {
        phone: form.phone,
      });

      setSmsSent(true);
      setDevelopmentSmsCode(response.data.developmentCode ?? "");
      setFieldError("smsCode");
      toast.success("Código enviado por SMS.");
    } catch (error: unknown) {
      setFieldError("smsCode", getErrorMessage(error, "Erro ao enviar SMS."));
      toast.error(getErrorMessage(error, "Erro ao enviar SMS."));
    } finally {
      setSendingSms(false);
    }
  }

  async function handleVerifySms() {
    if (!validateStepTwo()) {
      toast.error("Digite o código de 6 dígitos.");
      return;
    }

    try {
      setVerifyingSms(true);
      await api.post("/companies/onboarding/sms/verify", {
        phone: form.phone,
        code: smsCode,
      });

      setSmsVerified(true);
      setFieldError("smsCode");
      toast.success("Celular verificado com sucesso.");
      setCurrentStep(3);
    } catch (error: unknown) {
      setFieldError("smsCode", getErrorMessage(error, "Código inválido."));
      toast.error(getErrorMessage(error, "Código inválido."));
    } finally {
      setVerifyingSms(false);
    }
  }

  async function handleSubmit() {
    if (!validateStepFour()) {
      toast.error("Revise os dados do administrador antes de concluir.");
      return;
    }

    try {
      setSubmitting(true);
      const response = await api.post("/companies/onboarding", {
        companyName: form.companyName,
        contactName: form.contactName,
        phone: form.phone,
        cnpj: form.cnpj,
        domain: domainState?.normalizedDomain ?? form.domain,
        plan: form.plan,
        adminName: form.adminName,
        adminLogin: form.adminLogin,
        password: form.password,
      });

      setSuccess({
        loginEmail: response.data.loginEmail,
        plan: response.data.plan,
      });
      toast.success("Empresa cadastrada com sucesso.");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Erro ao concluir o cadastro."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNextStep() {
    if (currentStep === 1) {
      if (!validateStepOne()) {
        toast.error("Preencha os dados principais da empresa antes de continuar.");
        return;
      }

      const ok = await handleCheckDomain();
      if (!ok) return;
      setCurrentStep(2);
      return;
    }

    if (currentStep === 2) {
      if (!smsVerified) {
        validateStepTwo();
        toast.error("Confirme o código SMS antes de seguir.");
        return;
      }

      setCurrentStep(3);
      return;
    }

    if (currentStep === 3) {
      setCurrentStep(4);
    }
  }

  const hasErrors = Object.values(errors).some(Boolean);

  if (success) {
    return (
      <AuthShell backHref="/login" backLabel="Ir para o login">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-2xl flex-col justify-center py-16"
        >
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-400">
            cadastro concluído
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
            Sua empresa já pode
            <br />
            <span className="text-[#111111]/40 dark:text-[#f4f4f4]/40">
              entrar no UniPass.
            </span>
          </h1>

          <dl className="mt-10 divide-y divide-black/10 border-y border-black/10 font-mono text-sm dark:divide-white/10 dark:border-white/10">
            <div className="flex flex-wrap justify-between gap-3 py-4">
              <dt className="text-[#111111]/50 dark:text-[#f4f4f4]/50">login do administrador</dt>
              <dd className="break-all">{success.loginEmail}</dd>
            </div>
            <div className="flex justify-between gap-3 py-4">
              <dt className="text-[#111111]/50 dark:text-[#f4f4f4]/50">plano</dt>
              <dd>{success.plan}</dd>
            </div>
          </dl>

          <p className="mt-6 max-w-lg text-sm leading-7 text-[#111111]/60 dark:text-[#f4f4f4]/60">
            Próximo passo: entre no painel, cadastre seus alunos com o domínio da
            empresa e depois crie os acessos dos alunos a partir desses cadastros.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className={primaryButtonClass}>
              Ir para o login
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/" className={secondaryButtonClass}>
              Voltar para o início
            </Link>
          </div>
        </motion.div>
      </AuthShell>
    );
  }

  return (
    <AuthShell backHref="/" backLabel="Voltar">
      <div className="grid gap-12 py-12 lg:grid-cols-[13rem_minmax(0,1fr)_16rem] lg:gap-16 lg:py-20">
        <ol className="flex gap-6 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:gap-0 lg:overflow-visible">
          {steps.map((step, index) => {
            const active = step.id === currentStep;
            const completed =
              step.id < currentStep || (step.id === 2 && smsVerified);
            return (
              <li
                key={step.id}
                className="relative flex shrink-0 items-start gap-3 lg:pb-8"
              >
                {index < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[11px] top-7 hidden h-[calc(100%-1.75rem)] w-px bg-black/10 lg:block dark:bg-white/10"
                  >
                    <motion.span
                      className="block w-full bg-[#ff5c00]"
                      animate={{ height: completed ? "100%" : "0%" }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                    />
                  </span>
                )}
                <span
                  className={cn(
                    "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] transition-colors",
                    completed
                      ? "border-[#ff5c00] bg-[#ff5c00] text-white"
                      : active
                        ? "border-[#ff5c00] text-[#ff5c00]"
                        : "border-black/20 text-[#111111]/45 dark:border-white/20 dark:text-[#f4f4f4]/45",
                  )}
                >
                  {completed ? <Check className="size-3" /> : step.id}
                </span>
                <span className="whitespace-nowrap">
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      active
                        ? ""
                        : "text-[#111111]/55 dark:text-[#f4f4f4]/55",
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="hidden text-xs text-[#111111]/45 lg:block dark:text-[#f4f4f4]/45">
                    {step.hint}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            {currentStep === 1 && (
              <motion.section key="step-1" {...stepMotion} className="space-y-8">
                <StepHeader
                  eyebrow="01 · Empresa"
                  title="Comece pelo domínio e pela identidade da operação."
                  text="O domínio vira a assinatura da empresa no UniPass: todo usuário e aluno entra com um e-mail dele."
                />

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Nome da empresa" placeholder="Tavares Transporte" value={form.companyName} onChange={(e) => updateField("companyName", e.target.value)} error={errors.companyName} />
                  <Field label="Responsável" placeholder="Nome completo" value={form.contactName} onChange={(e) => updateField("contactName", e.target.value)} error={errors.contactName} />
                  <Field label="Celular" placeholder="(11) 99999-0000" inputMode="tel" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} error={errors.phone} />
                  <Field label="CNPJ" placeholder="00.000.000/0001-00" inputMode="numeric" value={form.cnpj} onChange={(e) => updateField("cnpj", e.target.value)} error={errors.cnpj} />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="company-domain"
                    className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#111111]/55 dark:text-[#f4f4f4]/55"
                  >
                    Domínio institucional
                  </label>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      id="company-domain"
                      value={form.domain}
                      onChange={(e) => {
                        setDomainState(null);
                        setFieldError("domain");
                        setForm((prev) => ({ ...prev, domain: e.target.value }));
                      }}
                      placeholder="tavarestransporte.com.br"
                      autoCapitalize="none"
                      className={cn(
                        fieldInputClass,
                        errors.domain ? fieldErrorBorderClass : fieldBorderClass,
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => void handleCheckDomain()}
                      disabled={checkingDomain}
                      className={`${secondaryButtonClass} shrink-0`}
                    >
                      {checkingDomain ? <Spinner /> : null}
                      {checkingDomain ? "Validando…" : "Validar domínio"}
                    </button>
                  </div>

                  <FieldMessage
                    error={errors.domain}
                    hint={
                      domainState?.available
                        ? `Domínio liberado: ${domainState.normalizedDomain}`
                        : undefined
                    }
                  />

                  <AnimatePresence>
                    {domainState && !domainState.available && domainState.suggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-wrap gap-2 pt-1"
                      >
                        {domainState.suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({ ...prev, domain: suggestion }));
                              void handleCheckDomain(suggestion);
                            }}
                            className="cursor-pointer rounded-full border border-black/15 px-3 py-1.5 font-mono text-xs transition hover:border-[#ff5c00] hover:text-[#ff5c00] dark:border-white/20"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.section>
            )}

            {currentStep === 2 && (
              <motion.section key="step-2" {...stepMotion} className="space-y-8">
                <StepHeader
                  eyebrow="02 · Verificação"
                  title="Confirme o celular da operação."
                  text="Antes de liberar o ambiente, confirmamos o número principal da empresa."
                />

                <div className="rounded-2xl border border-black/10 p-5 dark:border-white/10">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#111111]/55 dark:text-[#f4f4f4]/55">
                    celular informado
                  </p>
                  <p className="mt-1 font-mono text-lg">{form.phone}</p>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start">
                    <button
                      type="button"
                      onClick={() => void handleSendSms()}
                      disabled={sendingSms}
                      className={cn(
                        smsSent ? secondaryButtonClass : primaryButtonClass,
                        "shrink-0",
                      )}
                    >
                      {sendingSms ? <Spinner /> : null}
                      {sendingSms ? "Enviando…" : smsSent ? "Reenviar código" : "Enviar código"}
                    </button>

                    <div className="flex-1">
                      <input
                        value={smsCode}
                        onChange={(e) => {
                          setSmsCode(e.target.value);
                          setFieldError("smsCode");
                        }}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        aria-label="Código de 6 dígitos"
                        className={cn(
                          fieldInputClass,
                          "font-mono text-lg tracking-[0.4em] placeholder:tracking-[0.4em]",
                          errors.smsCode ? fieldErrorBorderClass : fieldBorderClass,
                        )}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleVerifySms()}
                      disabled={verifyingSms || !smsSent}
                      className={`${primaryButtonClass} shrink-0`}
                    >
                      {verifyingSms ? <Spinner /> : null}
                      {verifyingSms ? "Validando…" : "Confirmar"}
                    </button>
                  </div>

                  <div className="mt-3">
                    <FieldMessage
                      error={errors.smsCode}
                      hint={
                        smsVerified
                          ? "Celular confirmado. Você já pode seguir para o plano."
                          : developmentSmsCode
                            ? `Ambiente local — código de desenvolvimento: ${developmentSmsCode}`
                            : undefined
                      }
                    />
                  </div>
                </div>
              </motion.section>
            )}

            {currentStep === 3 && (
              <motion.section key="step-3" {...stepMotion} className="space-y-8">
                <StepHeader
                  eyebrow="03 · Plano"
                  title="Escolha o ritmo da implantação."
                  text="Dá para começar simples e evoluir depois sem trocar o domínio."
                />

                <div className="grid gap-3">
                  {plans.map((plan) => {
                    const selected = form.plan === plan.id;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, plan: plan.id }))}
                        aria-pressed={selected}
                        className={cn(
                          "relative cursor-pointer rounded-2xl border p-5 text-left transition-colors",
                          selected
                            ? "border-[#ff5c00]"
                            : "border-black/10 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30",
                        )}
                      >
                        {selected && (
                          <motion.span
                            layoutId="plan-glow"
                            className="absolute inset-0 rounded-2xl bg-[#ff5c00]/[0.06]"
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          />
                        )}
                        <div className="relative flex flex-wrap items-baseline justify-between gap-3">
                          <span className="flex items-center gap-3">
                            <span
                              className={cn(
                                "flex size-5 items-center justify-center rounded-full border",
                                selected
                                  ? "border-[#ff5c00] bg-[#ff5c00] text-white"
                                  : "border-black/25 dark:border-white/25",
                              )}
                            >
                              {selected && <Check className="size-3" />}
                            </span>
                            <span className="text-lg font-semibold tracking-[-0.02em]">
                              {plan.name}
                            </span>
                          </span>
                          <span className="font-mono text-sm">
                            {plan.price}
                            <span className="text-[#111111]/45 dark:text-[#f4f4f4]/45">
                              {plan.period}
                            </span>
                          </span>
                        </div>
                        <p className="relative mt-2 pl-8 text-sm leading-6 text-[#111111]/60 dark:text-[#f4f4f4]/60">
                          {plan.description}
                        </p>
                        <p className="relative mt-2 pl-8 font-mono text-[11px] text-[#111111]/50 dark:text-[#f4f4f4]/50">
                          {plan.features.join(" · ")}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </motion.section>
            )}

            {currentStep === 4 && (
              <motion.section key="step-4" {...stepMotion} className="space-y-8">
                <StepHeader
                  eyebrow="04 · Acesso"
                  title="Crie o administrador da empresa."
                  text="É o primeiro acesso ao painel — quem vai cadastrar alunos e liberar os demais usuários."
                />

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Nome do administrador" placeholder="Nome completo" value={form.adminName} onChange={(e) => updateField("adminName", e.target.value)} error={errors.adminName} autoComplete="name" />

                  <div className="space-y-2">
                    <label
                      htmlFor="admin-login"
                      className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#111111]/55 dark:text-[#f4f4f4]/55"
                    >
                      Login do administrador
                    </label>
                    <div
                      className={cn(
                        "flex h-12 items-center rounded-xl border bg-white px-4 transition focus-within:border-[#ff5c00] focus-within:ring-4 focus-within:ring-[#ff5c00]/10 dark:bg-[#141416]",
                        errors.adminLogin ? fieldErrorBorderClass : fieldBorderClass,
                      )}
                    >
                      <input
                        id="admin-login"
                        value={form.adminLogin}
                        onChange={(e) => updateField("adminLogin", e.target.value)}
                        placeholder="nome.sobrenome"
                        autoCapitalize="none"
                        autoComplete="username"
                        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#111111]/35 dark:placeholder:text-[#f4f4f4]/30"
                      />
                      {normalizedDomainPreview && (
                        <span
                          className="max-w-[55%] shrink-0 truncate pl-2 font-mono text-xs text-[#111111]/50 dark:text-[#f4f4f4]/50"
                          title={`@${normalizedDomainPreview}`}
                        >
                          @{normalizedDomainPreview}
                        </span>
                      )}
                    </div>
                    <FieldMessage error={errors.adminLogin} />
                  </div>

                  <Field
                    label="Senha"
                    type={showPassword ? "text" : "password"}
                    placeholder="Mínimo de 6 caracteres"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => updateField("password", e.target.value)}
                    error={errors.password}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        className="flex size-9 cursor-pointer items-center justify-center rounded-full text-[#111111]/45 transition hover:text-[#111111] dark:text-[#f4f4f4]/45 dark:hover:text-[#f4f4f4]"
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    }
                  />
                  <Field
                    label="Confirmar senha"
                    type={showPassword ? "text" : "password"}
                    placeholder="Repita a senha"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={(e) => updateField("confirmPassword", e.target.value)}
                    error={errors.confirmPassword}
                  />
                </div>

                <div className="rounded-2xl border border-black/10 p-5 dark:border-white/10">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#111111]/55 dark:text-[#f4f4f4]/55">
                    acesso que será criado
                  </p>
                  <p className="mt-2 break-all font-mono text-base">
                    {adminEmailPreview || "defina o login do administrador"}
                  </p>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          <div className="mt-10 flex flex-col-reverse gap-3 border-t border-black/10 pt-6 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#111111]/45 dark:text-[#f4f4f4]/45">
              etapa {currentStep} de {steps.length}
            </span>

            <div className="flex flex-col gap-3 sm:flex-row">
              {currentStep > 1 && currentStep < 4 && (
                <button
                  type="button"
                  onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
                  className={secondaryButtonClass}
                >
                  <ArrowLeft className="size-4" />
                  Voltar
                </button>
              )}

              {currentStep < 4 ? (
                <button
                  type="button"
                  onClick={() => void handleNextStep()}
                  disabled={checkingDomain}
                  className={primaryButtonClass}
                >
                  {checkingDomain ? <Spinner /> : null}
                  Continuar
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={submitting}
                  className={primaryButtonClass}
                >
                  {submitting ? <Spinner /> : null}
                  {submitting ? "Concluindo…" : "Concluir cadastro"}
                  {!submitting && (
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#111111]/45 dark:text-[#f4f4f4]/45">
              resumo
            </p>
            <dl className="mt-4 divide-y divide-black/10 border-y border-black/10 text-sm dark:divide-white/10 dark:border-white/10">
              <SummaryRow label="empresa" value={form.companyName} />
              <SummaryRow label="domínio" value={domainState?.normalizedDomain || form.domain} />
              <SummaryRow label="plano" value={selectedPlan.name} />
              <SummaryRow label="admin" value={adminEmailPreview} />
            </dl>

            <AnimatePresence>
              {hasErrors && (
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-6 flex items-start gap-2 text-xs leading-5 text-red-600 dark:text-red-400"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  Existem campos que ainda precisam de ajuste nesta etapa.
                </motion.p>
              )}
            </AnimatePresence>

            <p className="mt-8 text-xs leading-6 text-[#111111]/50 dark:text-[#f4f4f4]/50">
              Depois do cadastro, alunos nascem com este domínio e os acessos deles
              são criados a partir do cadastro — sem conflito entre empresas, mesmo
              quando o login se repete.
            </p>
          </div>
        </aside>
      </div>
    </AuthShell>
  );
}

function StepHeader({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#ff5c00]">
        {eyebrow}
      </p>
      <h1 className="mt-4 max-w-xl text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
        {title}
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-7 text-[#111111]/60 dark:text-[#f4f4f4]/60">
        {text}
      </p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#111111]/45 dark:text-[#f4f4f4]/45">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 break-all transition-colors",
          !value && "text-[#111111]/35 dark:text-[#f4f4f4]/35",
        )}
      >
        {value || "a definir"}
      </dd>
    </div>
  );
}
