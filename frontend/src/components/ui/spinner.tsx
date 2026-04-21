import { cn } from "./cn";

interface SpinnerProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<SpinnerProps["size"]>, string> = {
  sm: "w-4 h-4 border-2",
  md: "w-8 h-8 border-2",
  lg: "w-10 h-10 border-2",
};

export function Spinner({ className, size = "md" }: SpinnerProps) {
  return (
    <div
      className={cn(
        "rounded-full border-blue-500 border-t-transparent animate-spin",
        SIZE_CLASS[size],
        className,
      )}
      aria-hidden="true"
    />
  );
}

