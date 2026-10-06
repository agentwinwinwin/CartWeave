"use client";
import {ButtonHTMLAttributes} from "react";
import styles from "./switch.module.css";
export function Switch({checked,onCheckedChange,children,...props}:Omit<ButtonHTMLAttributes<HTMLButtonElement>,"onChange"> & {checked:boolean;onCheckedChange:(checked:boolean)=>void}){
  return <button {...props} type="button" role="switch" aria-checked={checked} className={styles.switch} onClick={()=>onCheckedChange(!checked)}><span className={styles.track} aria-hidden="true"><span/></span><span>{children}</span></button>;
}
