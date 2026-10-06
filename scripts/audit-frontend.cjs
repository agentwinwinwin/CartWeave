// Read-only UI audit: no mutations, approvals, credentials or real publication.
const {chromium,launchOptions,baseURL,artifactDirectory}=require('./frontend-browser.cjs');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const routes=['/workflow','/workflow/builder','/workflow/live','/workflow/mapping','/products','/orders','/customers','/skills','/assistant','/connections/cj','/test-store'];
(async()=>{
 const browser=await chromium.launch(launchOptions);
 const directory=artifactDirectory;fs.mkdirSync(directory,{recursive:true});
 const reports=[];
 try{
  for(const route of routes){
   const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/backend/**',request=>['GET','HEAD'].includes(request.request().method())?request.continue():request.abort());
   await page.goto(baseURL+route,{waitUntil:'networkidle'});
   const name=route.slice(1).replaceAll('/','-');
   await page.screenshot({path:directory+'/'+name+'.png',animations:'disabled'});
   const viewports=[];
   for(const width of [1440,1100,760,390]){
    await page.setViewportSize({width,height:960});
    viewports.push(await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,
     headings:[...document.querySelectorAll('main h1, main h2')].map(el=>el.textContent).slice(0,6)})));
   }
   if(route!=='/test-store')await page.screenshot({path:directory+'/'+name+'-mobile.png',animations:'disabled'});
   assert.deepEqual(errors,[],route+' client error');
   for(const viewport of viewports)assert.equal(viewport.overflow,false,route+' overflow at '+viewport.width);
   assert.equal(await page.getByText('Jade Doe⌄',{exact:true}).count(),0);
   reports.push({route,errors,viewports});await page.close();
  }
  fs.writeFileSync(directory+'/report.json',JSON.stringify(reports,null,2));
  console.log('Passed '+reports.length+' routes × 4 viewports. No client exceptions or page overflow. Screenshots: '+directory);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exit(1);});
