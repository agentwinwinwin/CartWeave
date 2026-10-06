import { ReactNode } from "react";
import { AppNavigation } from "./app-navigation";

export function DashboardPanel({ index, label, active, children }: { index: number; label: string; active: string; children: ReactNode }) {
  return <section className="dashboard-panel"><div className="dashboard-panel__tag"><b>{index}</b>{label}</div><div className="dashboard-window"><header className="app-bar"><strong>CommerceOS</strong><AppNavigation active={active}/><div className="app-bar__tools"><span>⌕</span><span className="avatar">JD</span><span>⌄</span></div></header><div className="dashboard-content">{children}</div></div></section>;
}
