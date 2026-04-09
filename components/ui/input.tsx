import * as React from "react";
import { tv } from "tailwind-variants";
import { cn } from "@/lib/cn";

export const inputStyles = tv({
  base: [
    "flex h-11 w-full rounded-md border border-border bg-canvas px-3 py-2",
    "text-base text-ink placeholder:text-ink-muted",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
    "disabled:opacity-50 disabled:pointer-events-none",
    "aria-[invalid=true]:border-danger",
  ].join(" "),
});

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(inputStyles(), className)}
      {...props}
    />
  );
}
