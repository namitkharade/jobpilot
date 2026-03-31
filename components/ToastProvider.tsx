"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function getToastClasses(type: ToastType) {
  if (type === "success") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  }
  if (type === "error") {
    return "border-rose-300 bg-rose-50 text-rose-900";
  }
  return "border-zinc-300 bg-white text-zinc-900";
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const item: ToastItem = { id, message, type };

    setToasts((prev) => [...prev, item]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-md transition-all ${getToastClasses(item.type)}`}
            role="status"
            aria-live="polite"
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
