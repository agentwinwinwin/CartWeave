import { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import styles from "./workflow.module.css";
import { NodeAccess } from "./node-access";
import type { NodeEditMode } from "@/lib/workflow/operator-policy";

type Props = {
  eyebrow: string; title: string; description: string; label: string; meta: string;
  accent?: "green" | "violet" | "amber"; state?: string; onClick: () => void;
  detail?: string; position?: CSSProperties; order?: number; selected?: boolean;
  editMode?: NodeEditMode;
  accessLabel?: string;
};

/** Shared visual shell for a business workflow and its individual steps. */
export function WorkflowCard({eyebrow,title,description,label,meta,accent,state,onClick,detail,position,order,selected,editMode,accessLabel}:Props) {
  return <Card data-edit-mode={editMode} data-run-state={state || undefined} className={`${styles.card} ${editMode?styles[`access_${editMode}`]:""} ${accent?styles[accent]:""} ${state?styles[state]??"":""} ${selected?styles.selected:""}`} style={position}>
    {(state === "running" || state === "collaborating") && <svg className={styles.executionFrame} viewBox="0 0 260 168" preserveAspectRatio="none" aria-hidden="true">
      <rect className={styles.frameGlow} x="1.5" y="1.5" width="257" height="165" rx="17" pathLength="100"/>
      <rect className={styles.frameTrace} x="1.5" y="1.5" width="257" height="165" rx="17" pathLength="100"/>
    </svg>}
    <Button variant="ghost" className={styles.cardButton} onClick={onClick} aria-label={`打开${title}`} aria-pressed={selected}>
      <span className={styles.cardTop}><span>{eyebrow}</span>{editMode?<NodeAccess mode={editMode} label={accessLabel} compact/>:<span className={styles.cardArrow}>↗</span>}</span>
      <strong className={styles.cardTitle}>{title}</strong>
      <span className={styles.cardDescription}>{description}</span>
      {detail&&<span className={styles.cardDetail}>{detail}</span>}
      <span className={styles.cardFooter}><span><i/>{label}</span><span>{meta}</span></span>
    </Button>
    {order!==undefined&&<span className={styles.mobileLink} aria-hidden="true">↓</span>}
  </Card>;
}
