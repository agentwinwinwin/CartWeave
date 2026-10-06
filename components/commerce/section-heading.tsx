import { ReactNode } from "react";

export function SectionHeading({ title, description, actions }: { title: ReactNode; description: string; actions?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div>{actions && <div className="section-heading__actions">{actions}</div>}</div>;
}
