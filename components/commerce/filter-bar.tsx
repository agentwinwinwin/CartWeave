import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";

export function FilterBar({ placeholder, filters }: { placeholder: string; filters: string[] }) {
  return <div className="filter-bar"><div className="filter-bar__search"><span>⌕</span><Input placeholder={placeholder} aria-label={placeholder}/></div>{filters.map(label => <SelectField key={label} aria-label={label} defaultValue="all"><option value="all">{label}</option></SelectField>)}</div>;
}
