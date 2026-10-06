import { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function SelectField({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("ui-select", className)} {...props}>{children}</select>;
}
