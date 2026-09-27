// Captures the lb+oz bug BEFORE any fix: the extension on a frozen-pizza results page.
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const ROOT = import.meta.dirname;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rup-')), {
  channel: 'chromium', headless: !process.env.HEADED, viewport: { width: 900, height: 620 }, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});
await ctx.route('https://www.amazon.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(join(ROOT, 'fixtures/bug-pizza.html'), 'utf8') }));
const page = await ctx.newPage();
await page.goto('https://www.amazon.com/s?k=frozen+pizza');
await page.waitForSelector('.rup-badge', { timeout: 10000 });
await page.waitForTimeout(800);
const badges = await page.$$eval('[class*=rup]', (els) => els.map((e) => e.className + ': ' + e.textContent.trim()));
console.log(badges.join('\n'));
await page.screenshot({ path: join(ROOT, 'evidence/bug-pizza-v1.png') });
await ctx.close();
