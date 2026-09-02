"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { CheckCircle2, AlertCircle, Info, XCircle, X } from "lucide-react";
import { cn } from "../lib/utils";

type ToastVariant = "default" | "success" | "warning" | "danger";

interface ToastRecord {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastContextValue {
  toast: (input: Omit<Partial<ToastRecord>, "id"> & { title: string }) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const variantIcon: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  danger: XCircle,
};

const variantIconClass: Record<ToastVariant, string> = {
  default: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

/** App-wide toast host. Mount once near the root (see apps/web providers).
 *  Consume with `useToast()` anywhere below it in the tree. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue["toast"]>((input) => {
    const id = crypto.randomUUID();
    setToasts((current) => [
      ...current,
      {
        id,
        title: input.title,
        description: input.description,
        variant: input.variant ?? "default",
        duration: input.duration ?? 5000,
      },
    ]);
    return id;
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => {
          const Icon = variantIcon[t.variant];
          return (
            <ToastPrimitive.Root
              key={t.id}
              duration={t.duration}
              onOpenChange={(open) => {
                if (!open) dismiss(t.id);
              }}
              className={cn(
                "grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-lg",
                "data-[state=open]:animate-[bb-toast-in_200ms_var(--ease-decelerate)]",
                "data-[state=closed]:animate-[bb-toast-out_150ms_var(--ease-accelerate)]",
                "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
              )}
            >
              <Icon className={cn("size-4 mt-0.5", variantIconClass[t.variant])} aria-hidden="true" />
              <div className="flex flex-col gap-0.5 min-w-0">
                <ToastPrimitive.Title className="text-[13px] font-medium text-foreground">
                  {t.title}
                </ToastPrimitive.Title>
                {t.description && (
                  <ToastPrimitive.Description className="text-[12.5px] text-muted-foreground leading-relaxed">
                    {t.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close
                className="text-subtle-foreground hover:text-foreground rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-6 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** `const { toast } = useToast(); toast({ title: "Saved", variant: "success" })` */
export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return context;
}
