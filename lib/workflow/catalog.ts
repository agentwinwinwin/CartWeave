import source from "./catalog.json";
import type { Workflow, WorkflowNode, WorkflowRelation, SkillDefinition } from "@/components/commerce/workflow/model";

export type Profile = {id:string;name:string;channel:string;fulfillment:string;description:string};
export type Definition = Omit<WorkflowNode,"next"> & {version:string;profiles:string[];readOnly:boolean;required:boolean;passthrough:boolean};
export type Instance = {id:string;definitionId:string;title:string;skillId:string|null;config:Record<string,string|number>};
export type Edge = {id:string;source:string;target:string;kind:"forward"|"feedback"|"collaboration";label?:string;description?:string};
export type Template = {id:string;title:string;subtitle:string;profiles:string[];objective:string;trigger:string;note:string;nodes:Instance[];relations:Edge[];required:string[]};
export type Draft = {schemaVersion:"1";id:string;revision:number;profileId:string;templateId:string;title:string;nodes:Instance[];edges:Edge[]};
export type ValidationIssue = {code:string;message:string;nodeId?:string;edgeId?:string};
export type ValidationResult = {valid:boolean;revision:number;engine:string;errors:ValidationIssue[];warnings:string[]};
export const catalog=source as unknown as {version:string;profiles:Profile[];definitions:Definition[];templates:Template[];skills:SkillDefinition[]};
export const definitionFor=(id:string)=>catalog.definitions.find(item=>item.id===id)!;
export const forwardEdges=(nodes:Instance[]):Edge[]=>nodes.slice(0,-1).map((node,index)=>({id:`${node.id}:${nodes[index+1].id}`,source:node.id,target:nodes[index+1].id,kind:"forward"}));
export function fromTemplate(template:Template,profileId:string):Draft {
  const nodes=structuredClone(template.nodes);
  return {schemaVersion:"1",id:template.id,revision:1,profileId,templateId:template.id,title:template.title,nodes,edges:[...forwardEdges(nodes),...structuredClone(template.relations)]};
}
export function previewFlow(draft:Draft):Workflow {
  const template=catalog.templates.find(item=>item.id===draft.templateId)!;
  let context="TriggerContext";
  const nodes=draft.nodes.map(instance=>{
    const definition=definitionFor(instance.definitionId);
    const input=definition.passthrough?context:definition.input;
    const output=definition.passthrough?context:definition.output;
    context=output;
    return {...definition,id:instance.id,title:instance.title,input,output,skill:instance.skillId??undefined,next:draft.edges.find(edge=>edge.kind==="forward"&&edge.source===instance.id)?.target};
  });
  return {id:draft.id,number:"CUSTOM",title:draft.title,subtitle:catalog.profiles.find(item=>item.id===draft.profileId)!.name,trigger:template.trigger,cadence:"按需启动",scope:"已验证流程定义 · 前端模拟",result:"依据节点契约处理",note:template.note,nodes,relations:draft.edges.filter(edge=>edge.kind!=="forward") as WorkflowRelation[]};
}
