/**
 * CPF/CNPJ no navegador: só formatação e conferência dos dígitos
 * verificadores, para avisar antes de enviar. A validação que vale é a do
 * backend (billing-document.util.ts), que também cifra o documento.
 */
export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function allSame(digits: string) {
  return /^(\d)\1+$/.test(digits);
}

export function isValidCpf(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 11 || allSame(d)) return false;

  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(d[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export function isValidCnpj(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 14 || allSame(d)) return false;

  const weights12 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const check = (weights: number[]) => {
    const sum = weights.reduce((t, w, i) => t + w * Number(d[i]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return (
    check(weights12) === Number(d[12]) &&
    check([6, ...weights12]) === Number(d[13])
  );
}

/** Mensagem de erro, ou null se o documento estiver certo. */
export function validateCpfCnpj(value: string): string | null {
  const d = onlyDigits(value);

  if (d.length === 11) return isValidCpf(d) ? null : "CPF inválido. Confira os números.";
  if (d.length === 14) return isValidCnpj(d) ? null : "CNPJ inválido. Confira os números.";
  return "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).";
}

/** Formata enquanto digita: 000.000.000-00 ou 00.000.000/0000-00. */
export function formatCpfCnpj(value: string) {
  const d = onlyDigits(value).slice(0, 14);

  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }

  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
