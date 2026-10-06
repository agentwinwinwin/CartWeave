import { cn } from "@/lib/cn";

const items = ["工作流", "商品", "订单", "客户", "技能", "数据分析"];

export function AppNavigation({ active }: { active: string }) {
  return <nav className="app-navigation" aria-label="主导航">{items.map(item => <span key={item} className={cn(item === active && "is-active")}>{item}</span>)}</nav>;
}
