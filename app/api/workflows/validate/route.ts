import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request) {
  // This local design tool does not accept executable paths or code from requests.
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return Response.json({error:"不允许跨来源调用校验服务。"},{status:403});
  const reader=request.body?.getReader();
  if(!reader)return Response.json({error:"缺少流程定义"},{status:400});
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();return Response.json({error:"流程定义超过 256KB"},{status:413})}chunks.push(value)}
  const body=Buffer.concat(chunks).toString("utf8");
  try{JSON.parse(body)}catch{return Response.json({error:"流程定义不是有效 JSON"},{status:400})}
  const bundled=path.join(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3");
  const venv=path.join(process.cwd(),".venv/bin/python");
  const python=process.env.WORKFLOW_PYTHON||(existsSync(venv)?venv:existsSync(bundled)?bundled:"python3");
  try{
    const output=await new Promise<string>((resolve,reject)=>{
      const child=spawn(python,[path.join(process.cwd(),"server/workflow/validate.py")],{shell:false,stdio:["pipe","pipe","pipe"]});
      let out="";const timer=setTimeout(()=>{child.kill();reject(new Error("timeout"))},8000);
      child.stdout.on("data",chunk=>{out+=chunk.toString();if(out.length>524288){child.kill();reject(new Error("output limit"))}});
      child.stderr.resume();child.stdin.on("error",()=>{});
      child.on("error",error=>{clearTimeout(timer);reject(error)});
      child.on("close",code=>{clearTimeout(timer);if(code===0)resolve(out);else reject(new Error("validator unavailable"))});
      child.stdin.end(body);
    });
    return Response.json(JSON.parse(output));
  }catch{return Response.json({error:"Pydantic 校验服务不可用。请安装 server/workflow/requirements.txt，并配置 WORKFLOW_PYTHON。"},{status:503})}
}
