import * as React from "react";
import { Tabs } from "@base-ui/react/tabs";
import { cn } from "./cn";

export const UiTabs = Tabs.Root;
export const UiTabsPanel = Tabs.Panel;

export function UiTabsList({
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof Tabs.List>, "className"> & { className?: string }) {
  return (
    <Tabs.List
      className={cn("flex border-b border-slate-800 shrink-0", className)}
      {...props}
    />
  );
}

export function UiTabsTrigger({
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof Tabs.Tab>, "className"> & { className?: string }) {
  return (
    <Tabs.Tab
      className={cn(
        "flex-1 inline-flex items-center justify-center gap-0.5 rounded-none px-2 py-2.5",
        "text-xs font-medium border-b-2 border-transparent transition-colors cursor-pointer",
        "text-slate-400 hover:text-slate-200",
        "data-[active]:text-blue-400 data-[active]:border-blue-400 data-[active]:bg-slate-800/40",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        className,
      )}
      {...props}
    />
  );
}

