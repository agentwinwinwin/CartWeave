export type BusinessStore={id:string;name:string;readable:boolean;synced_at:string|null;has_more:boolean};
export function resolveSyncStore(stores:BusinessStore[],store:string){return stores.find(s=>s.id===store)??(!store&&stores.length===1?stores[0]:undefined);}
export type BusinessRow={id:string;store_id:string;store_name:string;external_id:string;revision:number;observed_at:string;source_ref:string;
 customer_name?:string|null;ordered_at?:string;currency?:string;total?:string;payment_status?:string;fulfillment_status?:string;tracking_number?:string|null;item_summary?:string;
 name?:string|null;email?:string|null;country?:string|null;status?:string};
export type BusinessReport={results:BusinessRow[];count:number;page:number;page_size:number;stores:BusinessStore[]};
export const paymentLabels:Record<string,string>={pending:'待支付',paid:'已支付',partially_refunded:'部分退款',refunded:'已退款',cancelled:'已取消',unknown:'支付状态未知'};
export const fulfillmentLabels:Record<string,string>={unfulfilled:'待履约',partial:'部分履约',fulfilled:'已履约',delivered:'已送达',cancelled:'已取消',unknown:'履约状态未知'};
