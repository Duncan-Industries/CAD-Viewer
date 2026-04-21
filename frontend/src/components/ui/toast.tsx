import * as React from "react";
import { Toast } from "@base-ui/react/toast";
import { cn } from "./cn";
import { Button } from "./button";

const toastManager = Toast.createToastManager();

export type ToastOptions = Parameters<(typeof toastManager)["add"]>[0];

export function toast(options: ToastOptions) {
  return toastManager.add(options);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <Toast.Provider toastManager={toastManager}>{children}</Toast.Provider>;
}

export function useToastManager() {
  return Toast.useToastManager();
}

export function Toaster() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport
        className={cn(
          "fixed z-[1000] right-4 bottom-4",
          "flex flex-col gap-2 outline-none",
        )}
      >
        {toasts.map((t) => (
          <Toast.Root
            key={`${t.id}:${t.updateKey}`}
            toast={t}
            className={cn(
              "w-[360px] max-w-[calc(100vw-2rem)]",
              "rounded-xl border border-slate-700 bg-slate-900 shadow-xl",
              "data-[ending-style]:opacity-0 data-[ending-style]:translate-y-1 data-[ending-style]:scale-[0.99]",
              "transition-[opacity,transform] duration-200",
            )}
          >
            <Toast.Content className="px-3.5 py-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Toast.Title className="text-sm font-semibold text-slate-100" />
                <Toast.Description className="mt-0.5 text-xs text-slate-400" />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Toast.Action
                  render={
                    <Button variant="outline" size="sm" />
                  }
                />
                <Toast.Close
                  aria-label="Close"
                  className={cn(
                    "rounded-md p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  )}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </Toast.Close>
              </div>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

