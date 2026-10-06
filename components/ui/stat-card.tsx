import { Card } from "./card";
import {Icon,type IconName} from './icon';

const icons:Record<'green'|'blue'|'slate'|'red',IconName> = { green:'box',blue:'orders',slate:'workflow',red:'warning' };

export function StatCard({ label, value, change, tone = "green" }: { label: string; value: string; change?: string; tone?: keyof typeof icons }) {
  return <Card className="stat-card"><span className={`stat-card__icon stat-card__icon--${tone}`}><Icon name={icons[tone]}/></span><span><small>{label}</small><strong>{value}</strong>{change&&<em className={tone === "red" ? "is-danger" : ""}>{change}</em>}</span></Card>;
}
