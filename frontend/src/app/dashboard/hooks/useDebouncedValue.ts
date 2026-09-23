"use client";

import { useEffect, useState } from "react";

/**
 * Atrasa a propagação de um valor. Usado na busca das listas para não disparar
 * uma requisição por tecla digitada.
 */
export function useDebouncedValue<T>(value: T, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === debounced) return;

    const timer = setTimeout(() => setDebounced(value), delay);

    return () => clearTimeout(timer);
  }, [value, debounced, delay]);

  return debounced;
}
