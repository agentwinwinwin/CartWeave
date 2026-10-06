// Optional browser QA dependency: install Playwright or expose it via NODE_PATH.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const macChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath=process.env.CHROME_PATH||(fs.existsSync(macChrome)?macChrome:undefined);
module.exports={
 chromium,
 launchOptions:{headless:true,...(executablePath?{executablePath}:{})},
 baseURL:process.env.FRONTEND_URL||'http://localhost:3000',
 artifactDirectory:process.env.FRONTEND_AUDIT_DIR||path.join(os.tmpdir(),'oceanflow-ui-audit-after'),
};
