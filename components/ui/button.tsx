import { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "pill";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  compact?: boolean;
}

export function Button({ className, variant = "secondary", compact, ...props }: ButtonProps) {
  return <button className={cn("ui-button", `ui-button--${variant}`, compact && "ui-button--compact", className)} {...props} />;
}
