import { useEffect, useRef, type CSSProperties } from "react";
import { edgeGeometry, transmissionDuration, type GraphEdge } from "./graph";
import type { Workflow } from "./model";
import styles from "./workflow-connection.module.css";

/** State-driven SVG beam. No timers, random flicker, or business state mutation. */
export function WorkflowConnection({ flow, edge, active, joint, completed, markerId }: { flow: Workflow; edge: GraphEdge; active: boolean; joint: boolean; completed: boolean; markerId: string }) {
  const geometry=edgeGeometry(flow,edge);
  const group=useRef<SVGGElement>(null);
  const duration=joint?Math.max(2200,transmissionDuration(flow,edge)):transmissionDuration(flow,edge);
  const variables={"--beam-duration":`${duration}ms`,"--beam-tail":Math.min(38,3600/geometry.length)} as CSSProperties;
  const marker=`url(#${markerId})`;
  // Dynamically mounted SMIL defaults to the SVG's original clock, not mount time.
  // Start explicitly when this edge becomes active, including feedback replay.
  useEffect(()=>{if(active||joint)group.current?.querySelectorAll("animateMotion").forEach(animation=>(animation as SVGAnimationElement).beginElement());},[active,joint,geometry.d,duration]);
  const particle=(reverse=false)=><g className={`${styles.particle} ${reverse?styles.reverse:""}`}>
    <circle r="11" className={styles.halo}/><circle r="5.5" className={styles.aura}/><circle r="2.8" className={styles.head}/><circle r="1.3" className={styles.core}/>
    <animateMotion begin="indefinite" path={geometry.d} dur={`${duration}ms`} repeatCount={joint?"indefinite":"1"} keyPoints={reverse?"1;0":"0;1"} keyTimes="0;1" calcMode="linear" fill="freeze" />
  </g>;
  return <g ref={group} data-edge-id={edge.id} data-edge-kind={edge.kind} data-active={active||joint} data-completed={completed} className={`${styles.connection} ${styles[edge.kind]} ${active?styles.active:""} ${joint?styles.joint:""} ${completed?styles.completed:""}`} style={variables}>
    <title>{edge.description??"步骤完成后传递结果"}</title>
    <path className={styles.track} d={geometry.d} markerStart={edge.kind==="collaboration"?marker:undefined} markerEnd={marker}/>
    {(active||joint)&&<>
      <path className={styles.railGlow} d={geometry.d}/>
      <path className={`${styles.beam} ${styles.beamGlow}`} pathLength="100" d={geometry.d}/>
      <path className={styles.beam} pathLength="100" d={geometry.d}/>
      <path className={`${styles.beam} ${styles.beamCore}`} pathLength="100" d={geometry.d}/>
      {particle()}
      {joint&&<><path className={`${styles.beam} ${styles.beamGlow} ${styles.reverseBeam}`} pathLength="100" d={geometry.d}/><path className={`${styles.beam} ${styles.reverseBeam}`} pathLength="100" d={geometry.d}/><path className={`${styles.beam} ${styles.beamCore} ${styles.reverseBeam}`} pathLength="100" d={geometry.d}/>{particle(true)}</>}
    </>}
    {[geometry.start,geometry.end].map(([cx,cy],index)=><circle key={index} cx={cx} cy={cy} r="2.6" className={styles.port}/>)}
    {edge.kind==="feedback"&&<text className={styles.label} x={geometry.labelX} y={geometry.labelY} textAnchor="middle">↶ {edge.label}</text>}
  </g>;
}
