const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const out = path.join(root, 'test-results');
fs.mkdirSync(out, { recursive: true });
const report = {
  scope: 'Isolated Chromium workspace using the real repository/chart methods and saved chart data. No real sessions, client records, or external network requests.',
  runs: []
};
let browser;
(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const built of [false, ...(fs.existsSync(path.join(root, 'dist')) ? [true] : [])]) {
    const base = built ? path.join(root, 'dist') : root;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [], blocked = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      if (url.hostname !== '127.0.0.1') { blocked.push(url.href); return route.abort(); }
      if (url.pathname === '/height-harness.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div></body></html>' });
      if (url.pathname === '/supabase-client.js') return route.fulfill({ contentType: 'application/javascript', body: 'export const supabase = {}; export const initialAuthUrl = location.href;' });
      const file = path.resolve(base, '.' + url.pathname);
      if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: 'Not found' });
      const contentType = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(file)] || 'text/plain';
      return route.fulfill({ contentType, body: fs.readFileSync(file) });
    });
    await page.goto('http://127.0.0.1/height-harness.html#/clients');
    await page.evaluate(async () => {
      const { mhRepository } = await import('/supabase-repository.js');
      const { createWorkspace } = await import('/workspace.js');
      mhRepository.listEvents = async () => [];
      window.__heightRepository = mhRepository;
      window.__originalGetBuildChart = mhRepository.getBuildChart.bind(mhRepository);
      createWorkspace(document.querySelector('#app'), mhRepository);
    });
    assert.equal(requests.includes('/build-charts.js'), false, 'Chart data should not load before opening the lookup');
    await page.locator('[data-tool="build"]').click();
    const dialog = page.locator('dialog.build-dialog');
    const company = dialog.locator('[name="company"]');
    const height = dialog.locator('[name="height"]');
    await page.waitForFunction(() => document.querySelector('dialog.build-dialog [name="company"]')?.disabled === false);
    assert.equal(await company.locator('option').count(), 5);
    assert.equal(await height.isDisabled(), true);
    const companies = ['Mutual of Omaha', 'American Amicable', 'Physicians Mutual', 'Corebridge Financial — SimpliNow Legacy'];
    const expected = [['129 lb','321 lb'],['343 lb','344-359 lb','360-374 lb','142 lb','137-141 lb'],['145 lb','319 lb'],['129 lb','354 lb','137 lb','330 lb']];
    const counts = [27,29,28,27];
    for (let i = 0; i < companies.length; i++) {
      await company.selectOption(companies[i]);
      assert.equal(await height.locator('option').count(), counts[i] + 1);
      assert.equal(await dialog.locator('[data-build-result] .contact-grid').count(), 0);
      await height.selectOption('74');
      await dialog.locator('[data-build-result] .contact-grid').waitFor();
      assert.deepEqual(await dialog.locator('[data-build-result] .contact-grid section > strong').allTextContents(), expected[i]);
      assert.match(await dialog.locator('[data-build-result]').innerText(), /Source reference:/);
    }
    await company.selectOption('American Amicable');await height.selectOption('53');
    await page.waitForFunction(() => document.querySelector('[data-build-result]')?.textContent.includes('Refer to Home Office'));
    await company.selectOption('Physicians Mutual');await height.selectOption('83');
    await page.waitForFunction(() => document.querySelector('[data-build-result]')?.textContent.includes('401 lb'));
    // Simulate a stale, slow result followed by Reset. It must not repaint the cleared lookup.
    await page.evaluate(() => { window.__heightRepository.getBuildChart = criteria => new Promise(resolve => { window.__resolveHeight = () => window.__originalGetBuildChart(criteria).then(resolve); }); });
    await height.selectOption('74');
    await page.waitForFunction(() => typeof window.__resolveHeight === 'function');
    await dialog.locator('[data-build-reset]').click();
    await page.evaluate(() => window.__resolveHeight());
    assert.equal(await company.inputValue(), '');assert.equal(await height.isDisabled(), true);
    assert.equal(await dialog.locator('[data-build-result] .contact-grid').count(), 0);
    // Close a pending lookup and reopen it: the old result must never appear in the new window.
    await company.selectOption(companies[0]);await height.selectOption('74');
    await dialog.locator('[data-close]').click();
    await page.evaluate(async () => { await window.__resolveHeight(); window.__heightRepository.getBuildChart = window.__originalGetBuildChart; });
    await page.locator('[data-tool="build"]').click();
    await page.waitForFunction(() => document.querySelector('dialog.build-dialog [name="company"]')?.disabled === false);
    assert.equal(await company.inputValue(), '');assert.equal(await height.inputValue(), '');
    assert.equal(await dialog.locator('[data-build-result] .contact-grid').count(), 0);
    // Old [] response bug is handled as an invalid response, not an uncaught .map error.
    await page.evaluate(() => { window.__heightRepository.getBuildChart = async () => []; });
    await company.selectOption(companies[0]);await height.selectOption('74');
    await page.waitForFunction(() => document.querySelector('[data-build-result]')?.textContent.includes('Height & Weight unavailable'));
    assert.equal(await dialog.locator('[data-build-result] .contact-grid').count(), 0);
    await page.evaluate(() => { window.__heightRepository.getBuildChart = async () => null; });
    await height.selectOption('73');
    await page.waitForFunction(() => document.querySelector('[data-build-result]')?.textContent.includes('No chart row available'));
    await page.evaluate(() => { window.__heightRepository.getBuildChart = window.__originalGetBuildChart; });
    await company.selectOption(companies[1]);await height.selectOption('74');
    await dialog.locator('[data-build-result] .contact-grid').waitFor();
    for (const width of [1440,390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(out, `height-weight-${built ? 'built' : 'source'}-${width}.png`) });
    }
    assert.deepEqual(errors, []);assert.deepEqual(blocked, []);
    report.runs.push({ mode: built ? 'built' : 'source', companies: 4, importedHeightRows: 111, reset: 'pass', closeReopen: 'pass', staleResponse: 'pass', malformedResponse: 'pass', missingRow: 'pass', errors, externalRequests: blocked.length });
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'build-chart-browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(async error => {
  fs.writeFileSync(path.join(out, 'build-chart-browser.json'), JSON.stringify({ ...report, failure: error.message, stack: error.stack }, null, 2));
  console.error(error);await browser?.close();process.exitCode = 1;
});
