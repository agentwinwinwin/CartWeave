// Test-only, in-memory interfaces. Not installed adapters or live platform calls.
const assert = require('node:assert/strict');

const product = {productId:'mock-hat',title:'Cotton hat',price:'23.00',currency:'USD',market:'US',sku:'mock-black',inventory:5};
function mockInterface(channel) {
  const records=new Map(); let writes=0;
  return {
    product:structuredClone(product),
    map(approved, config) {
      assert.ok(approved.approvalRef && approved.draftDigest, 'Missing final approval evidence');
      if(channel==='amazon') {
        assert.ok(config.sellerId && config.marketplaceId && config.productType, 'Missing Amazon seller, marketplace or product type');
        // One-SKU illustrative payload, not a full Amazon product-type schema.
        return {sellerId:config.sellerId,sku:product.sku,marketplaceIds:[config.marketplaceId],body:{productType:config.productType,requirements:'LISTING',attributes:{item_name:[{value:product.title,language_tag:'en_US',marketplace_id:config.marketplaceId}],purchasable_offer:[{currency:product.currency,marketplace_id:config.marketplaceId,our_price:[{schedule:[{value_with_tax:23}]}]}],fulfillment_availability:[{fulfillment_channel_code:'DEFAULT',quantity:5}]}}};
      }
      return {name:product.title,price_minor:2300,currency:product.currency,sku:product.sku,stock:5};
    },
    submit(key,payload,{reject=false,timeoutAfterWrite=false}={}) {
      if(records.has(key)){assert.deepEqual(records.get(key).payload,payload,'Idempotency conflict');return records.get(key).receipt;}
      if(reject)return channel==='amazon'?{sku:product.sku,status:'INVALID',issues:[{severity:'ERROR',message:'Missing required product attribute'}]}:{error:'validation_failed'};
      writes++;
      const receipt=channel==='amazon'?{sku:product.sku,status:'ACCEPTED',submissionId:'mock-submission',issues:[]}:{id:'mock-store-product',state:'processing',request_id:'mock-submission'};
      records.set(key,{payload:structuredClone(payload),receipt,buyable:false});
      if(timeoutAfterWrite)throw new Error('Unknown result: recover using original operation key');
      return receipt;
    },
    lookup(key){return records.get(key)?.receipt??null;},
    receipt(raw,key){
      if(channel==='amazon' && raw.status!=='ACCEPTED')throw new Error('Publication rejected');
      if(channel!=='amazon' && raw.error)throw new Error('Publication rejected');
      return {schemaVersion:'1',productId:product.productId,channel,submissionId:channel==='amazon'?raw.submissionId:raw.request_id,idempotencyKey:key,submittedAt:'2026-10-03T00:00:00Z',status:channel==='amazon'?'accepted':'processing',issueRefs:[],providerReceiptRef:`mock://receipts/${key}`};
    },
    confirm(key){assert.ok(records.has(key));records.get(key).buyable=true;},
    query(key){const item=records.get(key);assert.ok(item);return channel==='amazon'?{sku:product.sku,summaries:[{marketplaceId:'MOCK-US',status:item.buyable?['DISCOVERABLE','BUYABLE']:['DISCOVERABLE']}],issues:[]}:{id:'mock-store-product',published:item.buyable,available:item.buyable,stock:5};},
    evidence(raw,receipt){
      const buyable=channel==='amazon'?raw.summaries.some(s=>s.marketplaceId==='MOCK-US'&&s.status.includes('BUYABLE')):raw.published&&raw.available&&raw.stock>0;
      if(!buyable)return null;
      return {schemaVersion:'1',productId:product.productId,channel,channelListingId:channel==='amazon'?raw.sku:raw.id,submissionRef:receipt.providerReceiptRef,sellable:true,confirmedAt:'2026-10-03T00:01:00Z',confirmationEvidenceRef:`mock://query/${channel}/${receipt.idempotencyKey}`};
    },
    get writes(){return writes;},
  };
}
module.exports={mockInterface};
