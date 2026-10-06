import { type Workflow, type WorkflowRelation, workflowRelations } from "./model";

export type GraphEdge = {id:string;source:string;target:string;kind:"forward"|WorkflowRelation["kind"];label?:string;description?:string};
export const position=(index:number)=>{const row=Math.floor(index/3);return {x:40+(row%2?2-index%3:index%3)*340,y:32+row*240}};
export function edgesFor(flow:Workflow):GraphEdge[] {
  return [
    ...(flow.forwardEdges??flow.nodes.filter(node=>node.next).map(node=>({id:`${node.id}:${node.next}`,source:node.id,target:node.next!,kind:"forward" as const}))),
    ...(flow.relations??workflowRelations[flow.id]??[]),
  ];
}
export function edgeGeometry(flow:Workflow,edge:GraphEdge) {
  const a=position(flow.nodes.findIndex(node=>node.id===edge.source));
  const b=position(flow.nodes.findIndex(node=>node.id===edge.target));
  const route=(points:number[][],labelX:number,labelY:number)=>{
    // Round orthogonal corners without leaving the existing safe routing lanes.
    let d=`M${points[0][0]} ${points[0][1]}`;
    let length=0;
    for(let i=1;i<points.length;i++) {
      const previous=points[i-1],current=points[i],next=points[i+1];
      length+=Math.hypot(current[0]-previous[0],current[1]-previous[1]);
      if(!next){d+=` L${current[0]} ${current[1]}`;continue;}
      const incoming=Math.hypot(current[0]-previous[0],current[1]-previous[1]);
      const outgoing=Math.hypot(next[0]-current[0],next[1]-current[1]);
      const radius=Math.min(28,incoming/2,outgoing/2);
      const before=current.map((value,axis)=>value-(value-previous[axis])*radius/(incoming||1));
      const after=current.map((value,axis)=>value+(next[axis]-value)*radius/(outgoing||1));
      d+=` L${before[0]} ${before[1]} Q${current[0]} ${current[1]} ${after[0]} ${after[1]}`;
    }
    return {d,labelX,labelY,length,start:points[0],end:points.at(-1)!};
  };
  if(edge.kind==="feedback") {
    // Route through the outer gutter and inter-row lanes, away from card bodies.
    return route([[a.x+130,a.y],[a.x+130,a.y-18],[18,a.y-18],[18,b.y+194],[b.x+130,b.y+194],[b.x+130,b.y+168]],Math.max(150,(a.x+148)/2),a.y-24);
  }
  if(edge.kind==="collaboration"&&a.y!==b.y){
    return route([[a.x+130,a.y],[a.x+130,a.y-12],[982,a.y-12],[982,b.y+192],[b.x+130,b.y+192],[b.x+130,b.y+168]],970,(a.y+b.y)/2);
  }
  if(a.y===b.y) return route(b.x>a.x?[[a.x+260,a.y+84],[b.x,b.y+84]]:[[a.x,a.y+84],[b.x+260,b.y+84]],(a.x+b.x+260)/2,a.y+84);
  const start=[a.x+130,a.y+168],end=[b.x+130,b.y];
  const middle=(start[1]+end[1])/2;
  // Smooth vertical tangents keep a cross-row connection out of card bodies.
  return {d:`M${start[0]} ${start[1]} C${start[0]} ${middle} ${end[0]} ${middle} ${end[0]} ${end[1]}`,labelX:(start[0]+end[0])/2,labelY:middle,length:Math.hypot(end[0]-start[0],end[1]-start[1])+Math.abs(end[0]-start[0])*.15,start,end};
}

/** Shared by animation and demo cursor so the next node never starts before arrival. */
export function transmissionDuration(flow:Workflow,edge?:GraphEdge) {
  return edge?Math.round(Math.min(2400,Math.max(1050,edgeGeometry(flow,edge).length*1.7))):1050;
}
