import * as React from "react";
import { tv, type VariantProps } from "tailwind-variants";
import { cn } from "@/lib/cn";

export const buttonStyles = tv({
  base: [
    "inline-flex items-center justify-center gap-2 rounded-md font-medium",
    "transition-colors focus-visible:ring-2 focus-visible:ring-brand-ring",
    "focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none",
  ].join(" "),
  variants: {
    variant: {
      solid: "bg-brand text-brand-fg hover:bg-brand-strong",
      outline:
        "border border-brand text-brand hover:bg-brand hover:text-brand-fg",
      ghost: "text-brand hover:bg-brand/10",
    },
    size: {
      sm: "h-9 px-3 text-sm",
      md: "h-11 px-5 text-base",
      lg: "h-12 px-6 text-lg",
    },
  },
  defaultVariants: {
    variant: "solid",
    size: "md",
  },
});

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles>;

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(buttonStyles({ variant, size }), className)}
      {...props}
    />
  );
}
