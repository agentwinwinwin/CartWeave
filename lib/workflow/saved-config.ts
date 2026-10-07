import type {WorkflowDocument} from './universal';
import {backendRequest} from './backend-client';
import {parseWorkflowDocument} from './client';
export type SavedDesign={id:string;revision:number;digest:string;document:WorkflowDocument};
export type FrozenDesign={id:string;revision:number;digest:string;document:WorkflowDocument;version_id:string;store_id:string;store_version:number;scope:'phase-one-publication'|'cj-launch'|'support'|'product-images'|'fulfillment'};
export async function savedDesigns(){const rows=await backendRequest<SavedDesign[]>('workflow-designs');return rows.map(row=>({...row,document:parseWorkflowDocument(JSON.stringify(row.document))}));}
export function saveDesign(document:WorkflowDocument,expectedRevision:number){return backendRequest<SavedDesign>('workflow-designs','POST',{document,expected_revision:expectedRevision});}
export function freezeDesign(saved:SavedDesign){return backendRequest<FrozenDesign>(`workflow-designs/${saved.id}/freeze`,'POST',{expected_revision:saved.revision});}
