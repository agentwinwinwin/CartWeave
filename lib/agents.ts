export type AgentPurpose='assistant'|'customer_support'|'product_image_plan';
export type AgentMessage={role:'user'|'assistant';content:string;model?:string;connection_id?:string;usage?:{harness?:{runtime:string;version:string;events:string[]}}};
export type AgentSession={id:string;purpose:AgentPurpose;revision:number;messages:AgentMessage[];result:Record<string,unknown>;busy:boolean};
export type AgentSkill={id:AgentPurpose|'product_image_batch'|'product_image_photography'|'customer_support_rag';title:string;version:string;digest:string;kind:'runtime-model-policy';output:string|null;tools:string[];scope:string};
export const agentPurposeNames:Record<AgentPurpose,string>={assistant:'运营对话',customer_support:'智能客服 · 回复建议',product_image_plan:'商品图 · 生成方案'};
export function agentMessageText(message:AgentMessage){
 if(message.role==='user')return message.content;
 try{const parsed=JSON.parse(message.content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  if(parsed.schema_version==='SupportReply@1'&&typeof parsed.reply==='string')return parsed.reply;
  if(parsed.schema_version==='ProductImagePlan@1'&&typeof parsed.prompt==='string')return parsed.prompt;
 }catch{/* Plain text stays text. */}
 return message.content;
}
