import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export interface ToastState {
  msg: string;
  error?: boolean;
}

interface ToastApi {
  toast: ToastState | null;
  flash: (msg: string, error?: boolean) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const flash = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  return <ToastContext.Provider value={{ toast, flash }}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
