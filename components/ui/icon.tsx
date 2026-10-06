import type {SVGProps} from 'react';
const paths={
 clock:'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 workflow:'M4 4h6v6H4z M14 14h6v6h-6z M7 10v7h7 M17 4v6 M14 7h6',
 box:'m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5',
 orders:'M7 3h10v4H7z M7 5H5v16h14V5h-2 M8 12h8 M8 16h5',
 people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87',
 sparkles:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
 chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l2-5a8.5 8.5 0 1 1 16-3.5Z',
 connect:'M9 15 15 9 M7 14l-2 2a3 3 0 0 0 4 4l2-2 M13 6l2-2a3 3 0 0 1 5 5l-2 2',
 arrow:'M7 17 17 7 M7 7h10v10',
 info:'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 close:'m6 6 12 12 M6 18 18 6',
 check:'m5 12 4 4L19 6',
 warning:'m12 3 10 18H2L12 3Z M12 9v5 M12 17h.01',
 search:'M21 21 16.5 16.5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
} as const;
export type IconName=keyof typeof paths;
export function Icon({name,size=20,...props}:SVGProps<SVGSVGElement>&{name:IconName;size?:number}){
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]}/></svg>;
}
