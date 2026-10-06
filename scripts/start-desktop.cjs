// Personal local workspace: no user login, both HTTP servers bind loopback.
const {spawn}=require("node:child_process");
const {existsSync}=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
if(!existsSync(path.join(root,"backend/.local/config.json"))||!existsSync(path.join(root,".next/BUILD_ID"))){
  console.error("请先按 backend/README.md 初始化本机工作区，并执行 npm run build。");
  process.exit(1);
}
const env={...process.env,COMMERCE_ENV:"local",COMMERCE_DESKTOP:"1",COMMERCE_HARNESS_NODE:process.execPath};
const python=process.env.WORKFLOW_PYTHON||path.join(root,"server/.venv/bin/python");
const children=[];
let closing=false;
function stop(code=0){if(closing)return;closing=true;for(const child of children)child.kill("SIGTERM");process.exitCode=code;}
function launch(command,args,cwd){
  const child=spawn(command,args,{cwd,env,stdio:"inherit"});
  children.push(child);
  child.on("error",()=>{console.error("本机服务启动失败，请检查运行环境。");stop(1);});
  child.on("exit",code=>{if(!closing)stop(code||1);});
}
launch(python,["manage.py","runserver","127.0.0.1:8010","--noreload"],path.join(root,"backend"));
launch(python,["manage.py","runworker"],path.join(root,"backend"));
launch(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"start","-H","127.0.0.1","-p","3000"],root);
process.on("SIGINT",()=>stop());
process.on("SIGTERM",()=>stop());
