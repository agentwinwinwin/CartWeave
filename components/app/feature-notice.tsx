import type {ReactNode} from 'react';
import {Icon} from '@/components/ui/icon';
export function FeatureNotice({title,children,actions}:{title:string;children:ReactNode;actions?:ReactNode}){
 return <aside className="feature-notice"><Icon name="info"/><div><strong>{title}</strong><p>{children}</p></div>{actions&&<div className="feature-notice__actions">{actions}</div>}</aside>;
}
