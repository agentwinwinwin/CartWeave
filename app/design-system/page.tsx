import { notFound } from "next/navigation";
import { DesignSystemPreview } from "@/components/design-system/design-system-preview";

export default function DesignSystemPage(){
  if(process.env.NODE_ENV!=="development") notFound();
  return <DesignSystemPreview/>;
}
