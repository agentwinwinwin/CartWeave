import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "success" | "info" | "danger" | "warning" | "neutral";

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn("ui-badge", `ui-badge--${tone}`, className)} {...props} />;
}
