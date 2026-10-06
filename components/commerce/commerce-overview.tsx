"use client";
import { useEffect, useState } from "react";
import { AiModule } from "./ai-module";
import { CustomerModule } from "./customer-module";
import { OrderModule } from "./order-module";
import { ProductModule } from "./product-module";
import { SkillModule } from "./skill-module";
import { WorkflowModule } from "./workflow-module";

export function CommerceOverview(){const [toast,setToast]=useState("");useEffect(()=>{if(!toast)return;const id=window.setTimeout(()=>setToast(""),1800);return()=>window.clearTimeout(id)},[toast]);return <><header className="site-header"><strong>CommerceOS</strong><i/><div><h1>用 AI 驱动跨境电商的每一个增长环节</h1><p>从选品到上架、从订单到客户，CommerceOS 让电商经营更简单、更智能。</p></div><aside><p>更智能的电商运营，从这里开始。</p><small>AUTOMATE · SCALE · GROW</small></aside></header><main className="overview-grid"><WorkflowModule notify={setToast}/><ProductModule/><OrderModule/><CustomerModule/><SkillModule notify={setToast}/><AiModule notify={setToast}/></main><div className={`toast ${toast?"is-visible":""}`} role="status" aria-live="polite">{toast}</div></>}
