/* Opt-in browser QA against the production renderer, with synthetic IPC data.
   Does not open the database, read credentials, or contact provider APIs.
   Set PLAYWRIGHT_MODULE if Playwright is supplied by an external runtime. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = require('node:http');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.UI_RENDERER_ROOT || path.resolve(__dirname, '../out/renderer'));
const output = path.resolve(__dirname, '../out/ui-qa');
mkdirSync(output, { recursive: true });
const mode = process.argv[2] || 'after';
const server = createServer((req, res) => {
  try {
    const file = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.statusCode = 404; res.end(); }
});

async function fixtures() {
  const providers = ['grok', 'codex', 'claude'];
  const now = new Date().toISOString();
  const settings = { display_currency: 'USD', locale: 'en-US', timezone: 'UTC', retention_days: 90, notify_enabled: true, network_quota_refresh: true, onboarding_completed: true, enabled_providers: {}, price_overrides: {}, plans: {} };
  const daily = Array.from({ length: 30 }, (_, i) => providers.map((provider, p) => {
    const date = new Date(); date.setUTCDate(date.getUTCDate() - 29 + i);
    const day = date.toISOString().slice(0, 10);
    const total = Math.round((0.45 + Math.sin(i * 0.8 + p) ** 2) * (p + 1) * 160000);
    return { day, bucket_start_ms: Date.parse(day), provider, tokens_total: total, uncached_input: Math.round(total * .2), cached_input: Math.round(total * .65), cache_creation: 0, output: total - Math.round(total * .2) - Math.round(total * .65), reasoning: 1000, model_calls: 20, session_count: 3, api_equiv_usd: total / 200000, provider_cost_usd: total / 300000, cache_savings_usd: total / 100000, unpriced_calls: 0 };
  })).flat();
  const numeric = ['tokens_total', 'uncached_input', 'cached_input', 'cache_creation', 'output', 'reasoning', 'model_calls', 'session_count', 'api_equiv_usd', 'provider_cost_usd', 'cache_savings_usd'];
  const by_provider = providers.map(provider => Object.assign({ provider, unpriced_calls: 0 }, Object.fromEntries(numeric.map(key => [key, daily.filter(d => d.provider === provider).reduce((sum, d) => sum + d[key], 0)]))));
  const totals = Object.fromEntries(numeric.map(key => [key, by_provider.reduce((sum, p) => sum + p[key], 0)]));
  const overview = { ...totals, by_provider, range_days: 30, avg_daily_tokens: totals.tokens_total / 30, avg_used_pct: 35, token_breakdown: totals, unpriced_sessions: 0, pricing: { status: 'fresh', source: 'Fixture rates', known_models: 2500, fetched_at: now }, fx: { status: 'fresh', source: 'Fixture FX', rates: { USD: 1 }, currencies: ['USD'], rates_date: now.slice(0, 10), fetched_at: now } };
  const models = by_provider.map((p, i) => ({ ...p, model: ['grok-code-fast', 'gpt-5.4', 'claude-sonnet-4.6'][i], share: p.tokens_total / totals.tokens_total }));
  const sessions = Array.from({ length: 100 }, (_, i) => ({ id: String(i), provider: providers[i % 3], project: ['API Gateway', 'Commerce Platform', 'Design System', 'Customer Portal', 'Data Pipeline'][i % 5], model: models[i % 3].model, tokens_in: 3000, tokens_cached: 10000, tokens_out: 1200, tokens_total: 14200, tokens_reasoning: 100, model_calls: 4, api_equiv_usd: .42, provider_cost_usd: null, cache_savings_usd: .2, status: 'complete', started_at: now, ended_at: now, duration_ms: 240000, source: 'fixture' }));
  const quotas = providers.map((provider, i) => ({ provider, confidence: 'live', auth_connected: true, used_pct: [24, 41, 68][i], remaining_pct: [76, 59, 32][i], plan_label: 'Team', plan_source: 'api', window_label: 'Weekly', reset_at: new Date(Date.now() + 3 * 86400000).toISOString(), captured_at: now, source: 'Synthetic QA fixture' }));
  const health = providers.map(provider => ({ provider, source_label: 'Fixture source', watcher_status: 'watching', last_scan_at: now, last_success_at: now, last_error: null, sessions_seen: 100, last_duration_ms: 12 }));
  const burn = providers.map((provider, p) => ({ id: provider, provider, label: provider + ' weekly', points: daily.filter(d => d.provider === provider).map((d, i) => ({ day: d.day, used_pct: Math.min(99, i * 2 + p * 10), projected: i > 26 })) }));
  const subset = (rows, f) => rows.filter(row => (!f?.provider || f.provider === 'all' || row.provider === f.provider));
  window.__qa = { fail: false, empty: false, exports: [], sessionRequests: [] };
  window.api = {
    getOverview: async () => { if (window.__qa.fail) throw Error('Synthetic refresh failure'); return window.__qa.empty ? { ...overview, tokens_total: 0, session_count: 0, by_provider: [] } : overview; },
    getQuotas: async () => quotas,
    getDailyUsage: async f => window.__qa.empty ? [] : subset(daily, f),
    getBurnSeries: async () => burn,
    getModelMix: async f => window.__qa.empty ? [] : subset(models, f),
    getModelUsage: async f => subset(daily, f).map(d => ({ ...d, model: models.find(m => m.provider === d.provider).model })),
    getSessions: async f => { window.__qa.sessionRequests.push(f); return window.__qa.empty ? [] : subset(sessions, f).filter(s => !f?.search || `${s.project} ${s.model}`.toLowerCase().includes(f.search.toLowerCase())).filter(s => !f?.model || s.model === f.model); },
    getProjections: async () => [], listAlerts: async () => [], getSettings: async () => settings,
    getCollectorHealth: async () => health,
    getAnalyticsSnapshot: async () => null,
    refreshQuotas: async () => undefined,
    setSettings: async p => Object.assign(settings, p),
    exportData: async args => { window.__qa.exports.push(args); return { cancelled: true }; },
    rescanProvider: async () => ({ upserted: 100 }),
    onChanged: () => () => {}, onAlert: () => () => {}
  };
}

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(fixtures);
  const start = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.metrics').waitFor();
  const readyMs = Date.now() - start;
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(output, `${mode}-overview-dark.png`) });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const idleStart = await metrics();
  await page.waitForTimeout(1000);
  const idleEnd = await metrics();
  if (mode.startsWith('bench')) {
    const results = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now(); await page.reload(); await page.locator('.metrics').waitFor();
      results.push(Date.now() - start);
    }
    const report = { mode, readyMs, warmReadyMs: results, idleTaskMs: (idleEnd.TaskDuration - idleStart.TaskDuration) * 1000, heapMB: idleEnd.JSHeapUsedSize / 1024 / 1024 };
    writeFileSync(path.join(output, `${mode}-report.json`), JSON.stringify(report, null, 2));
    console.log(report); await browser.close(); server.close(); return;
  }
  if (mode !== 'before') {
    await page.getByRole('button', { name: 'Expand usage chart' }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Stacked bars', exact: true }).click();
    await page.locator('.chart-bar').first().scrollIntoViewIfNeeded();
    const bar = await page.locator('.chart-bar').first().boundingBox();
    await page.mouse.move(bar.x + bar.width * .95, bar.y + bar.height / 2);
    const firstDay = new Date(); firstDay.setDate(firstDay.getDate() - 29);
    const firstLabel = firstDay.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (!(await page.locator('.tt-title').innerText()).includes(firstLabel)) errors.push('Stacked bar hover selected the wrong day');
    await page.getByRole('button', { name: 'Share %', exact: true }).click();
    await page.getByRole('button', { name: 'Data table', exact: true }).click();
    await page.getByRole('table').first().waitFor();
    await page.getByRole('button', { name: 'Trend', exact: true }).click();
    await page.getByRole('button', { name: 'Share %', exact: true }).click();
    await page.locator('.allowance-item').first().click();
    await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await page.getByRole('textbox', { name: 'Find an action' }).fill('sessions');
    await page.keyboard.press('Enter');
    await page.locator('.session-open').first().click();
    await page.getByRole('dialog', { name: 'Session details' }).waitFor();
    await page.screenshot({ path: path.join(output, 'session-drawer.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('navigation').getByRole('button', { name: 'Analytics', exact: true }).click();
    await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('custom');
    await page.getByLabel('From', { exact: true }).fill('2026-08-01');
    await page.getByLabel('To', { exact: true }).fill('2026-08-31');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    const chart = page.locator('.chart-svg').first();
    await chart.focus(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    await page.locator('.session-open').first().waitFor();
    const scope = await page.evaluate(() => window.__qa.sessionRequests.at(-1));
    if (scope.start_day !== '2026-08-01' || scope.end_day !== '2026-08-31' || !scope.day) errors.push('Custom-range drilldown lost scope');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export CSV', exact: true }).click();
    const exported = await page.evaluate(() => window.__qa.exports.at(-1).filter);
    if (exported.start_day !== scope.start_day || exported.day !== scope.day) errors.push('Export lost selected scope');
    await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('7');
  }
  const views = ['Analytics', 'Sessions', 'Forecast', 'Collectors', 'Settings', 'Overview'];
  for (const view of views) {
    await page.locator('.nav-item').filter({ hasText: new RegExp('^' + view) }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, `${mode}-${view.toLowerCase()}.png`) });
  }
  for (const width of [960, 620, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, `${mode}-${width}.png`) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) errors.push(`Viewport overflow at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Toggle colour theme' }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, `${mode}-overview-light.png`) });
  if (mode !== 'before') {
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Compact', exact: true }).click();
    await page.reload(); await page.locator('.metrics').waitFor();
    if (await page.locator('html').getAttribute('data-density') !== 'compact') errors.push('Density not retained');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('navigation').getByRole('button', { name: 'Analytics', exact: true }).click();
    const animation = await page.locator('.view').evaluate(el => getComputedStyle(el).animationName);
    if (animation !== 'none') errors.push('Reduced motion not respected');
    await page.evaluate(() => { window.__qa.fail = true; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText(/Showing the last loaded data/).waitFor();
    await page.evaluate(() => { window.__qa.fail = false; window.__qa.empty = true; });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByText('No usage in this window', { exact: true }).waitFor();
  }
  const report = { mode, readyMs, idleTaskMs: (idleEnd.TaskDuration - idleStart.TaskDuration) * 1000, heapMB: idleEnd.JSHeapUsedSize / 1024 / 1024, errors };
  writeFileSync(path.join(output, `${mode}-report.json`), JSON.stringify(report, null, 2));
  console.log(report);
  await browser.close(); server.close();
  if (errors.length) process.exitCode = 1;
})().catch(async error => { console.error(error); await browser?.close(); server.close(); process.exitCode = 1; });
