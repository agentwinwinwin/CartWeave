import { ReactNode } from "react";

export type TableColumn<T> = { key: keyof T; label: string; width?: string; render?: (row: T) => ReactNode };

export function DataTable<T extends { id: string }>({ columns, rows, className = '',onSelect,selectedId,emptyText='没有符合条件的记录。' }: { columns: TableColumn<T>[]; rows: T[]; className?:string;onSelect?:(row:T)=>void;selectedId?:string;emptyText?:string }) {
  return <div className={`table-scroll ${className}`}><table className="data-table"><thead><tr>{columns.map(column => <th scope="col" key={String(column.key)} style={{ width: column.width }}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className={selectedId===row.id?'is-selected':undefined} tabIndex={onSelect?0:undefined} aria-label={onSelect?`查看 ${row.id}`:undefined} onClick={onSelect?()=>onSelect(row):undefined} onKeyDown={onSelect?event=>{if(event.target===event.currentTarget&&['Enter',' '].includes(event.key)){event.preventDefault();onSelect(row);}}:undefined}>{columns.map(column => <td key={String(column.key)}>{column.render ? column.render(row) : String(row[column.key])}</td>)}</tr>)}{!rows.length&&<tr><td colSpan={columns.length}><div className="empty-state">{emptyText}</div></td></tr>}</tbody></table></div>;
}
