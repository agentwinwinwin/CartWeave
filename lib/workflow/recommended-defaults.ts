/** Starting assumptions for new drafts, never supplier facts or frozen-run overrides. */
export const recommendedSelectionDefaults = {
  limit: 10,
  scanBudget: 1000,
  variantsPerProduct: 3,
  minimumInventory: 5,
  maximumDeliveryDays: 20,
  allowFactorySupply: false,
  factoryProcessingDays: 3,
  factorySaleLimit: 5,
  minimumCJSales90d: 1,
  platformFeeRate: 0,
  paymentFeeRate: 3,
  returnReserveRate: 5,
  targetContributionRate: 30,
  taxReserveUsd: 2,
} as const;

export function fillUnsetParameters(values:Record<string,unknown>, defaults:Record<string,unknown>) {
  const missing=Object.fromEntries(Object.entries(defaults).filter(([key])=>values[key]===undefined));
  return Object.keys(missing).length?{...values,...missing}:values;
}
