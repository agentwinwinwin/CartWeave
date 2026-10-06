"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {Icon,type IconName} from '@/components/ui/icon';
import {getBackendSession} from '@/lib/workflow/backend-client';

const nav=[
  ["/workflow","工作流"],["/schedules","定时器"],["/products","商品"],["/earnings","收益"],["/orders","订单"],["/customers","客户"],["/skills","技能"],["/assistant","对话 AI"],["/connections/cj","连接"],
];
const icons:IconName[]=['workflow','clock','box','orders','orders','people','sparkles','chat','connect'];

export function DashboardShell({children}:{children:ReactNode}){
  const pathname=usePathname();
  const [workspace,setWorkspace]=useState('工作区');
  const navigation=useRef<HTMLElement>(null);
  useEffect(()=>{
    const revealCurrent=()=>{const container=navigation.current;const current=container?.querySelector<HTMLElement>('[aria-current="page"]');if(!container||!current||container.scrollWidth<=container.clientWidth)return;const box=container.getBoundingClientRect();const item=current.getBoundingClientRect();if(item.left<box.left||item.right>box.right)container.scrollLeft+=item.left-box.left-(container.clientWidth-item.width)/2;};
    revealCurrent();window.addEventListener('resize',revealCurrent);return()=>window.removeEventListener('resize',revealCurrent);
  },[pathname]);
  useEffect(()=>{let active=true;getBackendSession().then(session=>{if(active)setWorkspace(session.authenticated?(session.mode==='desktop'?'本机工作区':'团队工作区'):'未登录');}).catch(()=>{if(active)setWorkspace('服务未连接');});return()=>{active=false};},[]);
  return <div className="app-shell"><a className="skip-link" href="#main-content">跳到主要内容</a><header className="main-header"><Link className="main-logo" href="/workflow"><span className="brand-mark"><Icon name="workflow" size={19}/></span>CommerceOS</Link><nav ref={navigation} className="main-nav" aria-label="主导航">{nav.map(([href,label],index)=>{const active=pathname===href||pathname.startsWith(`${href}/`);return <Link key={href} href={href} aria-current={active?'page':undefined} className={cn(active&&"is-active")}><Icon name={icons[index]} size={17}/><span>{label}</span></Link>})}</nav><div className="main-tools"><span className="workspace-label"><span/>{workspace}</span></div></header><main id="main-content" tabIndex={-1} className="app-main">{children}</main></div>
}
