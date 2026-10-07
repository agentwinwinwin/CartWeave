/** UI entry points, not server authorization or arbitrary graph execution. */
export function executionEntry(templateId: string) {
  if (templateId === 'launch') return {kind:'frozen', label:'运行流程', node:null} as const;
  if (templateId === 'product-images') return {kind:'frozen', label:'运行流程', node:'image.start'} as const;
  if (templateId === 'support') return {kind:'frozen', label:'运行流程', node:'support.propose'} as const;
  if (templateId === 'fulfillment') return {kind:'frozen', label:'运行流程', node:'order.start'} as const;
  if (templateId === 'optimize') return {kind:'independent', label:'生成复盘报告', node:'insight.propose'} as const;
  return {kind:'design', label:'执行器尚未接入', node:null} as const;
}
