import { useEffect, useId, useRef, type CSSProperties } from "react";
import { edgeGeometry, transmissionDuration, type GraphEdge } from "./graph";
import type { Workflow } from "./model";
import styles from "./workflow-connection.module.css";

/** State-driven SVG beam. No timers, random flicker, or business state mutation. */
export function WorkflowConnection({ flow, edge, active, joint, completed, markerId }: { flow: Workflow; edge: GraphEdge; active: boolean; joint: boolean; completed: boolean; markerId: string }) {
  const geometry=edgeGeometry(flow,edge);
  const group=useRef<SVGGElement>(null);
  const duration=joint?Math.max(2200,transmissionDuration(flow,edge)):transmissionDuration(flow,edge);
  const source=flow.nodes.find(node=>node.id===edge.source);
  const target=flow.nodes.find(node=>node.id===edge.target);
  const tint=(node:typeof source)=>node?.operatorPolicy?.mode==="skill"?"var(--color-blue)":node?.operatorPolicy?.mode==="parameters"?"var(--color-workflow-parameter)":"var(--color-muted)";
  const gradientId=`${markerId}-wire-${useId().replace(/:/g,"")}`;
  const variables={"--beam-duration":`${duration}ms`,"--beam-tail":Math.min(38,3600/geometry.length),"--wire-gradient":`url(#${gradientId})`,"--wire-tint":tint(source)} as CSSProperties;
  // Dynamically mounted SMIL defaults to the SVG's original clock, not mount time.
  // Start explicitly when this edge becomes active, including feedback replay.
  useEffect(()=>{if(active||joint)group.current?.querySelectorAll("animateMotion").forEach(animation=>(animation as SVGAnimationElement).beginElement());},[active,joint,geometry.d,duration]);
  const particle=(reverse=false)=><g className={`${styles.particle} ${reverse?styles.reverse:""}`}>
    <circle r="11" className={styles.halo}/><circle r="5.5" className={styles.aura}/><circle r="2.8" className={styles.head}/><circle r="1.3" className={styles.core}/>
    <animateMotion begin="indefinite" path={geometry.d} dur={`${duration}ms`} repeatCount={joint?"indefinite":"1"} keyPoints={reverse?"1;0":"0;1"} keyTimes="0;1" calcMode="linear" fill="freeze" />
  </g>;
  return <g ref={group} data-edge-id={edge.id} data-edge-kind={edge.kind} data-active={active||joint} data-completed={completed} className={`${styles.connection} ${styles[edge.kind]} ${active?styles.active:""} ${joint?styles.joint:""} ${completed?styles.completed:""}`} style={variables}>
    <title>{edge.description??"步骤完成后传递结果"}</title>
    <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={geometry.start[0]} y1={geometry.start[1]} x2={geometry.end[0]} y2={geometry.end[1]}><stop stopColor={tint(source)} stopOpacity=".35"/><stop offset="1" stopColor={tint(target)} stopOpacity=".35"/></linearGradient></defs>
    <path className={styles.track} d={geometry.d}/>
    {(active||joint)&&<>
      <path className={styles.railGlow} d={geometry.d}/>
      <path className={`${styles.beam} ${styles.beamGlow}`} pathLength="100" d={geometry.d}/>
      <path className={styles.beam} pathLength="100" d={geometry.d}/>
      <path className={`${styles.beam} ${styles.beamCore}`} pathLength="100" d={geometry.d}/>
      {particle()}
      {joint&&<><path className={`${styles.beam} ${styles.beamGlow} ${styles.reverseBeam}`} pathLength="100" d={geometry.d}/><path className={`${styles.beam} ${styles.reverseBeam}`} pathLength="100" d={geometry.d}/><path className={`${styles.beam} ${styles.beamCore} ${styles.reverseBeam}`} pathLength="100" d={geometry.d}/>{particle(true)}</>}
    </>}
    {[geometry.start,geometry.end].map(([cx,cy],index)=><circle key={index} cx={cx} cy={cy} r="1.8" className={styles.port}/>)}
    {edge.kind==="feedback"&&<text className={styles.label} x={geometry.labelX} y={geometry.labelY} textAnchor="middle">↶ {edge.label}</text>}
    {edge.kind==="forward"&&<g className={styles.transferLabel} transform={`translate(${geometry.labelX},${geometry.labelY})`}>
      <rect x="-32" y="-12" width="64" height="24" rx="12"/>
      <circle cx="-20" cy="0" r="2.5"/>
      <text x="1" y="3.5" textAnchor="middle">{active||joint?"传递中":"结果"}</text>
      <path className={styles.direction} d="m23 -3 3 3-3 3" transform={`rotate(${geometry.end[1]!==geometry.start[1]?90:geometry.end[0]<geometry.start[0]?180:0} 24 0)`}/>
    </g>}
  </g>;
}
