import snapshot from './snapshot.json';
export type Product = { id:string; name:string; category:string; department?:string; price:number; image:string; color:string; stock:number; status:string; badge?:string; description?:string; sizeStock?:Record<string,number|undefined>; gallery?:string[]; sku?:string };
export type HomepageFeature = {product:Product;title:string;score:number;listedCount:number;reason:string};
// A public storefront snapshot, not live CJ evidence or verified inventory.
export const products:Product[]=snapshot.products;
export const featured:HomepageFeature[]=snapshot.featured;
export function productMaterial(product:Product){return product.department==='Clothing'?'Supplier-selected ready-to-wear':product.category;}
