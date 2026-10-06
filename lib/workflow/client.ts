import { nodeDefinitions, validateWorkflowPreview, validStoreIntegration, type WorkflowDocument } from "./universal";
import { getChannels, validateCustomChannels, type SalesChannelDefinition } from "./channels";

const storageKey = "commerceos.workflow-document.v2";
/** This port can be replaced by an API client without changing editor components. */
export interface WorkflowDesignClient {
  readonly source: "browser-preview";
  save(document: WorkflowDocument): Promise<void>;
  load(): Promise<WorkflowDocument | null>;
  validate(document: WorkflowDocument): Promise<ReturnType<typeof validateWorkflowPreview>>;
}
export function parseWorkflowDocument(raw: string): WorkflowDocument {
  const value = JSON.parse(raw);
  const channelErrors = validateCustomChannels(value?.customChannels);
  const registeredChannels = getChannels(channelErrors.length ? [] : value?.customChannels ?? []).map(channel => channel.id);
  if (!value || value.schemaVersion !== "2" || typeof value.id !== "string" || typeof value.title !== "string" ||
    !Number.isInteger(value.revision) || value.revision < 1 || typeof value.templateId !== "string" || !value.environment ||
    (value.environment.storeRef !== undefined && typeof value.environment.storeRef !== "string") ||
    !validStoreIntegration(value.environment.storeIntegration, value.environment.channel) ||
    channelErrors.length > 0 || !registeredChannels.includes(value.environment.channel) || !["supplier", "merchant", "platform"].includes(value.environment.fulfillment) ||
    !Array.isArray(value.environment.capabilities) || !value.environment.capabilities.every((c: unknown) => typeof c === "string") ||
    !Array.isArray(value.nodes) || value.nodes.length < 2 || value.nodes.length > 40 ||
    !value.nodes.every((node: any) => node && typeof node.id === "string" && typeof node.title === "string" &&
      nodeDefinitions.some(d => d.id === node.definitionId) && node.binding && typeof node.binding.skillId === "string" &&
      typeof node.binding.skillVersion === "string" && ["default", "custom"].includes(node.binding.mode) &&
      node.binding.parameters && typeof node.binding.parameters === "object" && !Array.isArray(node.binding.parameters) &&
      (node.binding.connectionRef === undefined || typeof node.binding.connectionRef === "string") &&
      (node.binding.execution === undefined || (node.binding.execution && typeof node.binding.execution.timeoutSeconds === "number" &&
        typeof node.binding.execution.maxRetries === "number" && ["safe", "never"].includes(node.binding.execution.retryMode)))) ||
    !Array.isArray(value.edges) || value.edges.length > 100 || !value.edges.every((edge: any) => edge &&
      typeof edge.id === "string" && typeof edge.source === "string" && typeof edge.target === "string" &&
      ["forward", "feedback", "collaboration"].includes(edge.kind) &&
      (edge.label === undefined || typeof edge.label === "string") && (edge.description === undefined || typeof edge.description === "string")) ||
    !Array.isArray(value.customSkills) || value.customSkills.length > 100 || !value.customSkills.every((skill: any) =>
      skill && ["id", "name", "version", "runtime", "input", "output", "entrypointRef", "description"].every(key => typeof skill[key] === "string") &&
      ["script", "connector", "llm", "media", "composite", "manual"].includes(skill.runtime) &&
      skill.parameterSchema && typeof skill.parameterSchema === "object" && !Array.isArray(skill.parameterSchema) &&
      Object.values(skill.parameterSchema).every((p: any) => p && ["string", "number", "boolean"].includes(p.type) && typeof p.label === "string" &&
        (p.description === undefined || typeof p.description === "string") && (!p.enum || Array.isArray(p.enum) && p.enum.every((v: unknown) => ["string", "number", "boolean"].includes(typeof v)))) &&
      [skill.effects, skill.capabilities, skill.channels].every(items => Array.isArray(items) && items.every(item => typeof item === "string")) &&
      skill.effects.every((e: string) => ["read", "artifact", "remote_write", "spend", "message"].includes(e)) &&
      skill.channels.length > 0 && skill.channels.every((c: string) => c === "*" || registeredChannels.includes(c)) &&
      (!skill.fulfillments || Array.isArray(skill.fulfillments) && skill.fulfillments.every((f: string) => ["supplier", "merchant", "platform"].includes(f))))) throw new Error("文件不是当前版本的流程文档，请使用导出的 v2 JSON。");
  if(value.selectionStrategy!==undefined){
    const s=value.selectionStrategy;
    if(!s||typeof s!=='object'||s.definitionId!=='product.decide'||typeof s.id!=='string'||!s.id||value.nodes.some((n:any)=>n.id===s.id)||typeof s.title!=='string'||!s.binding||typeof s.binding.skillId!=='string'||typeof s.binding.skillVersion!=='string'||!['default','custom'].includes(s.binding.mode)||!s.binding.parameters||typeof s.binding.parameters!=='object'||Array.isArray(s.binding.parameters))throw new Error('选品与定价策略配置无效。');
  }
  return value as WorkflowDocument;
}
export const workflowDesignClient: WorkflowDesignClient = {
  source: "browser-preview",
  async save(document) { localStorage.setItem(storageKey, JSON.stringify(document)); },
  async load() { const raw = localStorage.getItem(storageKey); return raw ? parseWorkflowDocument(raw) : null; },
  async validate(document) { return validateWorkflowPreview(document); },
};

const channelStorageKey = "commerceos.sales-channels.v1";
/** Browser-only channel design catalog, separate from account connections and workflow drafts. */
export const salesChannelDesignClient = {
  source: "browser-preview" as const,
  async save(channels: SalesChannelDefinition[]): Promise<void> {
    const errors = validateCustomChannels(channels);
    if (errors.length) throw new Error(errors.join(" "));
    localStorage.setItem(channelStorageKey, JSON.stringify(channels));
  },
  async load(): Promise<SalesChannelDefinition[]> {
    const raw = localStorage.getItem(channelStorageKey);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    const errors = validateCustomChannels(value);
    if (errors.length) throw new Error(`本地渠道目录无效：${errors.join(" ")}`);
    return value as SalesChannelDefinition[];
  },
};
