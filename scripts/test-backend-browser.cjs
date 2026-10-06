/* Explicit local development E2E: creates one approved test listing, never spends money. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const runtime = process.env.CODEX_NODE_MODULES || path.join(__dirname, "../node_modules");
const { chromium } = require(path.join(runtime, 'playwright'));

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:3000/workflow/live');
    const session = await (await page.request.get('http://localhost:3000/backend/v1/auth/session')).json();
    if (!session.authenticated) {
      const access = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/.local/development-access.json'), 'utf8'));
      await page.getByLabel('用户名', {exact: true}).fill(access.username);
      await page.getByLabel('密码', {exact: true}).fill(access.password);
      await page.getByRole('button', {name: '登录后端', exact: true}).click();
    }
    const packageResponse = await page.request.get('http://localhost:3000/backend/v1/integration-packages');
    assert.equal(packageResponse.status(), 200);
    const packages = await packageResponse.json();
    assert.equal(packages.packages[0].format, 'commerceos.store-api@1');
    assert.ok(packages.packages[0].actions.some(a => a.action === 'publication.lookup'));
    await page.getByRole('heading', {name: '创建商品发布任务', exact: true}).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('button', {name: '验收测试站接口', exact: true}).click();
    const create = page.getByRole('button', {name: '创建真实发布任务', exact: true});
    await create.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '创建真实发布任务' && !b.disabled));
    const title = 'Workflow verified test ' + Date.now();
    await page.getByLabel('商品标题', {exact: true}).fill(title);
    await create.click();
    await page.getByRole('heading', {name: '第一轮：确认商品与售价', exact: true}).waitFor({timeout: 30000});
    await page.getByLabel('审批原因', {exact: true}).fill('确认测试商品、合成 CJ 规格与售价；不采购。');
    await page.getByRole('button', {name: '批准当前版本', exact: true}).click();
    await page.getByRole('heading', {name: '第二轮：审核最终上架草稿', exact: true}).waitFor({timeout: 30000});
    await page.getByLabel('审批原因', {exact: true}).fill('已核对标题、描述、图片、规格与售价，批准测试站发布。');
    await page.getByRole('button', {name: '批准当前版本', exact: true}).click();
    const productLink = page.getByRole('link', {name: '打开已发布商品 ↗', exact: true});
    await productLink.waitFor({timeout: 45000});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({path: '/private/tmp/commerce-backend-live.png', fullPage: true});
    const productUrl = await productLink.getAttribute('href');
    await productLink.click();
    await page.getByRole('heading', {name: title, exact: true}).waitFor({timeout: 30000});
    await page.reload();
    await page.getByRole('heading', {name: title, exact: true}).waitFor();
    for (const width of [1100, 760, 390]) {
      await page.setViewportSize({width, height: 844});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.goto('http://localhost:3000/workflow/live');
    await page.getByRole('heading', {name: '创建商品发布任务', exact: true}).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed: true, productUrl, source: 'test_fixture—not a CJ-selected product', checks: ['session+CSRF', 'installed API contracts', 'two approvals', 'durable publication', 'actual storefront detail', 'refresh persistence', 'responsive widths', 'no runtime errors']}));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exit(1); });
