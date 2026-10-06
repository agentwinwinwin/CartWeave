/** Sales-channel design registry. Capability declarations are not account permissions. */
export type Channel = string;
export type Fulfillment = "supplier" | "merchant" | "platform";
export type SalesChannelDefinition = {
  id: Channel;
  name: string;
  kind: "storefront" | "marketplace" | "social" | "custom";
  fulfillments: Fulfillment[];
  defaultFulfillment: Fulfillment;
  capabilities: string[];
  adapterStatus: "example" | "draft";
};

export const fulfillmentModes: Fulfillment[] = ["supplier", "merchant", "platform"];
export const channelKinds: SalesChannelDefinition["kind"][] = ["storefront", "marketplace", "social", "custom"];
export const channelCapabilityEffects = ["read", "artifact", "remote_write", "spend", "message"] as const;
export const channelIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export function allowedChannelCapabilities(id: string): string[] {
  return [...channelCapabilityEffects.map(effect => `${id}.${effect}`), "assets.generate"];
}
export const defaultChannelId = "test-store";
export const builtinChannels: SalesChannelDefinition[] = [
  { id: "test-store", name: "自建独立站（本地测试站）", kind: "storefront", fulfillments: ["supplier", "merchant"], defaultFulfillment: "supplier", capabilities: allowedChannelCapabilities("test-store"), adapterStatus: "draft" },
  { id: "shopify", name: "Shopify 店铺", kind: "storefront", fulfillments: ["supplier", "merchant"], defaultFulfillment: "supplier", capabilities: allowedChannelCapabilities("shopify"), adapterStatus: "example" },
  { id: "amazon", name: "Amazon", kind: "marketplace", fulfillments: ["merchant", "platform"], defaultFulfillment: "merchant", capabilities: allowedChannelCapabilities("amazon"), adapterStatus: "example" },
];
export function getChannels(customChannels: SalesChannelDefinition[] = []): SalesChannelDefinition[] {
  return [...builtinChannels, ...customChannels];
}
export function resolveChannel(id: string, customChannels: SalesChannelDefinition[] = []): SalesChannelDefinition | undefined {
  return getChannels(customChannels).find(channel => channel.id === id);
}

function shapeErrors(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["渠道定义必须是对象。"];
  const item = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof item.id !== "string" || item.id.length < 2 || item.id.length > 48 || !channelIdPattern.test(item.id)) errors.push("渠道 ID 需为 2–48 位小写字母、数字和连字符，并以字母开头。");
  if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || item.name !== item.name.trim()) errors.push("渠道名称需为 1–80 个字符，且不含首尾空格。");
  if (!channelKinds.includes(item.kind as SalesChannelDefinition["kind"])) errors.push("请选择有效的渠道类型。");
  if (!Array.isArray(item.fulfillments) || !item.fulfillments.length || item.fulfillments.some(mode => !fulfillmentModes.includes(mode as Fulfillment)) || new Set(item.fulfillments).size !== item.fulfillments.length) errors.push("渠道需声明至少一种有效且不重复的履约责任。");
  if (!fulfillmentModes.includes(item.defaultFulfillment as Fulfillment) || !Array.isArray(item.fulfillments) || !item.fulfillments.includes(item.defaultFulfillment)) errors.push("默认履约责任必须在渠道支持范围内。");
  if (!Array.isArray(item.capabilities) || item.capabilities.some(capability => typeof capability !== "string" || !allowedChannelCapabilities(typeof item.id === "string" ? item.id : "").includes(capability)) || new Set(item.capabilities).size !== item.capabilities.length) errors.push("能力声明仅支持本渠道的 read、artifact、remote_write、spend、message 与 assets.generate，且不可重复。");
  if (!["example", "draft"].includes(item.adapterStatus as string)) errors.push("渠道适配状态无效。");
  return errors;
}
/** Validate a newly added local design entry. Custom channels cannot claim a built-in adapter. */
export function validateSalesChannel(value: unknown, existingCustomChannels: SalesChannelDefinition[] = []): string[] {
  const errors = shapeErrors(value);
  if (existingCustomChannels.length >= 50) errors.push("本地渠道目录最多支持 50 个自定义渠道。");
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors;
  const item = value as Record<string, unknown>;
  if (item.adapterStatus !== "draft") errors.push("自定义渠道只能标记为待适配，不代表已有可执行接口。");
  const existing = getChannels(existingCustomChannels);
  if (existing.some(channel => channel.id === item.id)) errors.push("渠道 ID 已存在，不能覆盖内置或已添加渠道。");
  if (typeof item.name === "string") {
    const normalizedName = item.name.trim().toLocaleLowerCase();
    if (existing.some(channel => channel.name.trim().toLocaleLowerCase() === normalizedName)) errors.push("渠道名称已存在，请使用不同名称。");
  }
  return errors;
}
/** Structural registry check used by import and preview; not a backend permission check. */
export function validateCustomChannels(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) return ["自定义渠道清单需为不超过 50 项的数组。"];
  const accepted: SalesChannelDefinition[] = [];
  const errors: string[] = [];
  for (const [index, item] of value.entries()) {
    const itemErrors = validateSalesChannel(item, accepted);
    errors.push(...itemErrors.map(message => `渠道 ${index + 1}：${message}`));
    if (!itemErrors.length) accepted.push(item as SalesChannelDefinition);
  }
  return errors;
}
