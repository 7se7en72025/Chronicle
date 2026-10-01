import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
export async function createBrowserRecorder(root, origin) {
  let browser;
  const errors = [];
  for (const options of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
    try { browser = await chromium.launch({ ...options, headless: true }); break; } catch (error) { errors.push(error.message.split('\n')[0]); }
  }
  if (!browser) return { capture: null, close: async () => {}, error: 'No supported browser could launch. ' + errors.join(' ') };
  return {
    error: null,
    close: () => browser.close(),
    capture: async (run, checkpoint) => {
      const context = await browser.newContext({ viewport: { width: 1000, height: 660 }, storageState: checkpoint.environment.browserStorage });
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/sandbox/${run.id}/${checkpoint.index}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
        const dir = path.join(root, 'artifacts', run.id);
        await mkdir(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, `${checkpoint.index}.png`) });
        let browserAssertions = [];
        if (checkpoint.event.type === 'test') {
          const ownCount = await page.locator('.card').count();
          const title = await page.title();
          if (await page.locator('#new').count()) {
            await page.locator('#new').click();
            await page.getByRole('textbox', { name: 'Project name' }).fill('QA project');
            await page.getByRole('button', { name: 'Create project' }).click();
          }
          const created = await page.evaluate(() => window.__createdProject);
          browserAssertions = [
            { label: 'Dashboard renders without browser errors', passed: errors.length === 0 && title.includes('Folio'), detail: errors.join(', ') || 'No JavaScript errors.' },
            { label: 'Browser displays only owned projects', passed: ownCount === 2, detail: `${ownCount} project cards rendered; expected 2.` },
            { label: 'New-project form works', passed: created?.name === 'QA project' && created?.ownerId === 'alex', detail: 'Verified in the isolated browser; no external write.' },
          ];
          await page.goto(`${origin}/sandbox/${run.id}/${checkpoint.index}/index.html?session=anonymous`, { waitUntil: 'networkidle' });
          browserAssertions.push({ label: 'Anonymous browser sees sign-in screen', passed: (await page.getByRole('button', { name: 'Sign in to Folio' }).count()) === 1 && await page.locator('.card').count() === 0, detail: 'Checked with a missing session.' });
        }
        return { screenshot: `/artifacts/${run.id}/${checkpoint.index}.png`, storage: await context.storageState(), browser: { available: true, mode: 'reconstructed', errors, assertions: browserAssertions, viewport: { width: 1000, height: 660 } } };
      } finally { await context.close(); }
    },
  };
}
