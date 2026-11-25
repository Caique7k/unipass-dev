"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface SidebarContextType {
  isOpen: boolean;
  toggle: () => void;
  /** No celular o menu abre por cima da página; escolher um item o fecha. */
  closeOnMobile: () => void;
}

const SidebarContext = createContext({} as SidebarContextType);

// O mesmo ponto de corte das classes max-md/md da Sidebar.
function isDesktop() {
  return (
    typeof window === "undefined" ||
    window.matchMedia("(min-width: 768px)").matches
  );
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  // No celular começa fechado: aberto, o menu cobriria dois terços da tela.
  const [isOpen, setIsOpen] = useState(isDesktop);

  function toggle() {
    setIsOpen((prev) => !prev);
  }

  function closeOnMobile() {
    if (!isDesktop()) setIsOpen(false);
  }

  return (
    <SidebarContext.Provider value={{ isOpen, toggle, closeOnMobile }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
