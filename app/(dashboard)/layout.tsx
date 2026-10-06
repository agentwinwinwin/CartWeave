import { DashboardShell } from "@/components/app/dashboard-shell";

export default function DashboardLayout({children}:{children:React.ReactNode}){
  return <DashboardShell>{children}</DashboardShell>;
}
