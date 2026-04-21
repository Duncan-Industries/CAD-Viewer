import * as React from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = React.ComponentPropsWithoutRef<typeof BaseButton> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-white hover:bg-blue-500 border border-blue-500/30",
  secondary:
    "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700",
  outline:
    "bg-transparent text-slate-300 hover:bg-slate-800/60 border border-slate-700 hover:border-slate-600",
  ghost:
    "bg-transparent text-slate-300 hover:bg-slate-800/60 border border-transparent",
  danger:
    "bg-red-600 text-white hover:bg-red-500 border border-red-500/30",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "text-xs px-2.5 py-1.5 rounded-md",
  md: "text-sm px-3 py-2 rounded-lg",
  lg: "text-sm px-4 py-2.5 rounded-lg",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", disabled, ...props }, ref) => {
    return (
      <BaseButton
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 font-medium transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
          "disabled:opacity-50 disabled:pointer-events-none",
          VARIANT[variant],
          SIZE[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

