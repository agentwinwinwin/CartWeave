import { editModeLabels, type NodeEditMode } from "@/lib/workflow/operator-policy";
import styles from "./node-access.module.css";

/** Editability remains independent of running/error status; icon + text works without color. */
export function NodeAccess({ mode, compact = false, label }: { mode: NodeEditMode; compact?: boolean; label?: string }) {
  return <span className={`${styles.badge} ${styles[mode]} ${compact ? styles.compact : ""}`}>
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      {mode === "fixed" ? <><rect x="4" y="9" width="12" height="8" rx="2"/><path d="M6.5 9V6a3.5 3.5 0 0 1 7 0v3"/><path d="M10 12v2"/></> : mode === "parameters" ? <><path d="M3 5h14M3 10h14M3 15h14"/><circle cx="7" cy="5" r="2" fill="var(--color-surface)"/><circle cx="13" cy="10" r="2" fill="var(--color-surface)"/><circle cx="7" cy="15" r="2" fill="var(--color-surface)"/></> : <path d="m10 2 2.1 5.9L18 10l-5.9 2.1L10 18l-2.1-5.9L2 10l5.9-2.1L10 2Z"/>}
    </svg>{label ?? editModeLabels[mode]}
  </span>;
}
