"use client";

import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Eye, EyeOff, Lock, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/app/contexts/AuthContext";
import { AuthShell } from "@/components/auth/AuthShell";
import { LiveFeed } from "@/components/auth/LiveFeed";
import {
  Field,
  Spinner,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/auth/fields";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/services/api";

const REMEMBER_STORAGE_KEY = "unipass-remember-me";

type LoginDialogState = {
  title: string;
  description: string;
};

function getApiErrorMessage(error: unknown) {
  const message = axios.isAxiosError(error)
    ? error.response?.data?.message
    : null;

  if (Array.isArray(message)) {
    return message.find((item): item is string => typeof item === "string") ?? null;
  }

  return typeof message === "string" ? message : null;
}

export default function LoginPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginError, setLoginError] = useState<LoginDialogState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedValue = window.localStorage.getItem(REMEMBER_STORAGE_KEY);
    if (savedValue === "true") {
      setRememberMe(true);
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      toast.error("Informe seu e-mail para entrar.");
      return;
    }
    if (!password.trim()) {
      toast.error("Informe sua senha para entrar.");
      return;
    }

    try {
      setLoading(true);
      setLoginError(null);
      await api.post("/auth/login", {
        email: normalizedEmail,
        password,
        ...(rememberMe ? { rememberMe: true } : {}),
      });

      window.localStorage.setItem(REMEMBER_STORAGE_KEY, String(rememberMe));
      toast.success("Login realizado com sucesso.");
      await refreshUser();
      router.replace("/dashboard");
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        toast.error("E-mail ou senha inválidos.");
        setLoginError({
          title: "Login inválido",
          description: "O e-mail ou a senha informados estão incorretos.",
        });
      } else {
        const message =
          getApiErrorMessage(error) ?? "Não foi possível entrar agora.";
        toast.error(message);
        setLoginError({
          title: "Não foi possível entrar",
          description: message,
        });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell aside={<LiveFeed />}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
        className="mx-auto w-full max-w-md"
      >
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#ff5c00]">
          Entrar
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
          Acesse o painel.
        </h2>
        <p className="mt-3 text-sm leading-7 text-[#111111]/60 dark:text-[#f4f4f4]/60">
          Use o e-mail do domínio da sua empresa.
        </p>

        <form onSubmit={handleLogin} className="mt-10 space-y-5">
          <Field
            label="E-mail"
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com.br"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            leading={<Mail className="size-4" />}
          />

          <Field
            label="Senha"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Sua senha"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            leading={<Lock className="size-4" />}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="flex size-9 cursor-pointer items-center justify-center rounded-full text-[#111111]/45 transition hover:text-[#111111] dark:text-[#f4f4f4]/45 dark:hover:text-[#f4f4f4]"
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            }
          />

          <label className="flex cursor-pointer items-center gap-3 py-1 text-sm">
            <Checkbox
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(Boolean(checked))}
              className="size-4.5 rounded-md border-black/25 data-checked:border-[#ff5c00] data-checked:bg-[#ff5c00] data-checked:text-white dark:border-white/30"
            />
            <span className="text-[#111111]/70 dark:text-[#f4f4f4]/70">
              Manter conectado neste dispositivo
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className={`${primaryButtonClass} w-full`}
          >
            {loading ? (
              <>
                <Spinner />
                Entrando…
              </>
            ) : (
              <>
                Entrar
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 flex items-center justify-between border-t border-black/10 pt-6 text-sm dark:border-white/10">
          <span className="text-[#111111]/55 dark:text-[#f4f4f4]/55">
            Primeiro acesso?
          </span>
          <Link
            href="/cadastro/empresa"
            className="inline-flex items-center gap-1.5 font-semibold text-[#ff5c00] transition hover:text-[#e65300]"
          >
            Cadastrar empresa
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </motion.div>

      <AnimatePresence>
        {loginError && (
          <motion.div
            key="login-error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
          >
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setLoginError(null)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="login-error-title"
              aria-describedby="login-error-description"
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="relative w-full max-w-sm rounded-[28px] border border-black/10 bg-[#f7f7f5] p-6 dark:border-white/10 dark:bg-[#141416]"
            >
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setLoginError(null)}
                className="absolute right-4 top-4 cursor-pointer text-[#111111]/45 transition hover:text-[#111111] dark:text-[#f4f4f4]/45 dark:hover:text-[#f4f4f4]"
              >
                <X className="size-4" />
              </button>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-red-500">
                negado
              </p>
              <h3
                id="login-error-title"
                className="mt-3 text-xl font-semibold tracking-[-0.02em]"
              >
                {loginError.title}
              </h3>
              <p
                id="login-error-description"
                className="mt-2 text-sm leading-6 text-[#111111]/60 dark:text-[#f4f4f4]/60"
              >
                {loginError.description}
              </p>
              <button
                type="button"
                onClick={() => setLoginError(null)}
                className={`${secondaryButtonClass} mt-6 w-full`}
              >
                Tentar novamente
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
