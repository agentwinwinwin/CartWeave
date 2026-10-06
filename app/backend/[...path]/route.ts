import {createHmac} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const localOrigins = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

async function proxy(request:Request, context:{params:Promise<{path:string[]}>}) {
  const desktop=process.env.COMMERCE_DESKTOP==="1";
  const headers=new Headers();
  for(const name of ["content-type","cookie","x-csrftoken","origin","referer"])
    if(request.headers.has(name))headers.set(name,request.headers.get(name)!);
  if(!desktop&&request.headers.has("x-team-id"))headers.set("x-team-id",request.headers.get("x-team-id")!);
  if(desktop) {
    const host=request.headers.get("host");
    const origin=request.headers.get("origin");
    if(process.env.COMMERCE_ENV!=="local"||
      !["localhost:3000","127.0.0.1:3000"].includes(host??"")||
      request.headers.get("sec-fetch-site")==="cross-site"||
      (origin!==null&&!localOrigins.has(origin))||
      (!["GET","HEAD"].includes(request.method)&&!localOrigins.has(origin??"")))
      return Response.json({detail:"私人工作区仅允许本机页面访问。"}, {status:403});
    try {
      const config=JSON.parse(await readFile(join(process.cwd(),"backend/.local/config.json"),"utf8"));
      const secret=process.env.DJANGO_SECRET_KEY||config.secret_key;
      if(typeof secret!=="string"||!secret)throw Error("Missing local configuration");
      headers.set("X-Commerce-Desktop",createHmac("sha256",secret).update("commerceos-desktop-transport-v1").digest("hex"));
    } catch { return Response.json({detail:"本机工作区尚未初始化。"}, {status:503}); }
  }
  const {path}=await context.params;
  if(path.some(p=>p==="."||p===".."||/[\\/]/.test(p)))return Response.json({detail:"无效路径"}, {status:400});
  const base=desktop?"http://127.0.0.1:8010":process.env.COMMERCE_API_ORIGIN??"http://127.0.0.1:8010";
  const url=`${base}/api/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`;
  try {
    const response=await fetch(url,{method:request.method,headers,body:["GET","HEAD"].includes(request.method)?undefined:await request.arrayBuffer(),redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(90000)});
    const outgoing=new Headers({"Cache-Control":"no-store"});
    for(const name of ["content-type","www-authenticate","retry-after"])if(response.headers.has(name))outgoing.set(name,response.headers.get(name)!);
    for(const cookie of response.headers.getSetCookie())outgoing.append("set-cookie",cookie);
    return new Response(response.body,{status:response.status,headers:outgoing});
  } catch {return Response.json({detail:"本机后端暂时不可用，请检查服务是否已启动。"}, {status:503});}
}
export {proxy as GET,proxy as POST,proxy as PUT,proxy as PATCH,proxy as DELETE,proxy as HEAD};
