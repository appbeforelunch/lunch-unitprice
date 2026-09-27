/*
 * Real Unit Price - tests.
 *
 * Two layers:
 *   1. Pure parser cases run straight in Node against src/parse.js.
 *   2. End-to-end: a real Chromium loads the unpacked extension, every request
 *      to amazon.com is fulfilled from a local fixture, and the badges the
 *      content script actually renders are asserted.
 *
 * Run: npm test   (HEADED=1 npm test to watch it)
 */
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

/* ----------------------------------------------------------- tiny harness - */

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}\n         expected: ${e}\n         actual:   ${a}`);
    console.log(`  FAIL ${name}\n         expected: ${e}\n         actual:   ${a}`);
  }
}

/* ------------------------------------------------- layer 1: pure parsing - */

await import(pathToFileURL(join(ROOT, 'src/parse.js')).href);
const UP = globalThis.UnitPrice;

const unit = (price, size) => {
  const r = UP.unitPrice(price, size);
  return r ? r.text : null;
};

console.log('\nparser');
// The traps, each stated as the price/size text Amazon actually shows.
check('2-Pack multiplies the size', unit('$12.48', 'Jif Creamy Peanut Butter, 2-Pack, 40 oz Jars'), '$0.16 / oz');
check('Pack of N multiplies the size', unit('$14.97', 'Dish Soap, 19.4 fl oz (Pack of 3)'), '$0.26 / fl oz');
check('N x M binds multiplier to quantity', unit('$10.99', 'Sparkling Water, 12 x 16 fl oz cans'), '$0.057 / fl oz');
check('M unit x N reads reversed', unit('$10.99', 'Sparkling Water, 16 fl oz x 12'), '$0.057 / fl oz');
check('fluid ounces stay volume', unit('$4.00', 'Syrup, 8 fl oz'), '$0.50 / fl oz');
check('ounces stay weight', unit('$4.00', 'Chips, 8 oz'), '$0.50 / oz');
check('lbs converts to ounces', unit('$4.79', 'Peanut Butter, 1.5 lbs'), '$0.20 / oz');
check('lb converts to ounces', unit('$5.98', 'Peanut Butter Tub, 2 lb'), '$0.19 / oz');
check('grams report per 100 g', unit('$9.99', 'Almond Butter, 500g'), '$2.00 / 100 g');
check('kilograms report per 100 g', unit('$27.20', 'Dog Food, 2 x 1.36 kg'), '$1.00 / 100 g');
check('litres report per 100 ml', unit('$3.00', 'Olive Oil, 1 L'), '$0.30 / 100 ml');
check('count reports per ct', unit('$8.94', 'Protein Bars, Pack of 6'), '$1.49 / ct');
check('mg dosage is not a package size', unit('$11.99', 'Vitamin C 1000mg, 100 Count Tablets'), '$0.12 / ct');
check('count becomes the multiplier when a measured size exists',
  UP.parseSize('Bottled Water, 24 Count, 16.9 Fl Oz').totalBase, 405.59999999999997);
check('abbreviated fl. oz. is still volume', UP.parseSize('Dawn Dish Soap 32 fl. oz.').unitLabel, 'fl oz');
check('metric in parentheses does not beat the primary unit', UP.parseSize('Coffee, Net Wt 12 oz (340 g)').unitLabel, 'oz');
check('shipping dimensions are not a pack multiplier', UP.parseSize('Gift Box, 10.5 x 4 x 3 inches'), null);
check('unreadable size yields nothing', unit('$29.99', 'Gourmet Nut Butter Gift Basket Assortment'), null);
check('missing price yields nothing', unit('Currently unavailable', 'Sampler, 8 oz'), null);
check('thousands separator in price', UP.parsePrice('$1,249.99'), 1249.99);

// Compound imperial weights. Regression: reading only the pounds and dropping
// the ounces understated every package and handed "best value" to the worst
// deal on the frozen-pizza page.
const base = (text) => { const r = UP.parseSize(text); return r ? r.totalBase : null; };
check('1 lb 11.5 oz is 27.5 oz', base('Stone Oven Margherita Frozen Pizza, 1 lb 11.5 oz'), 27.5);
check('1 lb 4.6 oz is 20.6 oz', base('Thin Crust Four Cheese Frozen Pizza, 1 lb 4.6 oz'), 20.6);
check('1 lb 4 oz is 20 oz', base('Net Wt 1 lb 4 oz'), 20);
check('spelled-out pound and ounce compound', base('1 Pound 4 Ounce'), 20);
check('2 lb 3 oz is 35 oz', base('2 lb 3 oz'), 35);
check('2 lb 6 oz is 38 oz', base('Chicken Breast, 2 lb 6 oz package'), 38);
check('compound survives a trailing word', base('1 lb 8 oz bag'), 24);
check('decimal pounds alone still work', base('Ground Beef, 1.25 lb'), 20);
check('kg + g compound', base('1 kg 500 g'), 1500);
check('litre + ml compound', base('2 liters 500 ml'), 2500);
check('a pack term still multiplies a compound', base('1 lb 4 oz (Pack of 2)'), 40);
check('N x compound multiplies the whole compound', base('12 x 1 lb 4 oz'), 240);
// The two guards that keep the walk from over-reading.
check('bracketed restatement is not a continuation', base('NET WT 20 OZ (1 LB 4 OZ) 567g'), 20);
check('metric restatement still loses to the primary unit', base('Coffee, Net Wt 12 oz (340 g)'), 12);
check('a repeated unit is not summed', base('3 oz 2 oz'), 3);
check('a pack term is not read as a compound part', base('Pizza 1 lb, 4 Pack'), 64);

/* --------------------------------------------- layer 2: the real extension - */

const fixtures = {
  '/dp/B000DAWN3': readFileSync(join(ROOT, 'fixtures/product.html'), 'utf8'),
  '/s': readFileSync(join(ROOT, 'fixtures/search.html'), 'utf8'),
  '/s/pizza': readFileSync(join(ROOT, 'fixtures/bug-pizza.html'), 'utf8')
};

const profile = mkdtempSync(join(tmpdir(), 'rup-profile-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`
    ]
  });

  // Anything the extension tried to fetch would show up here. It must be empty.
  const offSite = [];
  context.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('https://www.amazon.com/') && !url.startsWith('devtools')) offSite.push(url);
  });

  await context.route('https://www.amazon.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = fixtures[path];
    if (!body) return route.fulfill({ status: 404, body: 'no fixture' });
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });

  const badges = (page) =>
    page.$$eval('.rup-badge', (els) => els.map((e) => e.textContent.trim()));

  const badgeForAsin = (page, asin) =>
    page.$eval(`[data-asin="${asin}"]`, (card) => {
      const b = card.querySelector('.rup-badge');
      return b ? b.textContent.trim() : null;
    });

  /* -- product page -- */
  const product = await context.newPage();
  await product.goto('https://www.amazon.com/dp/B000DAWN3');
  await product.waitForSelector('.rup-badge', { timeout: 10000 });

  console.log('\nproduct page');
  check('one badge on the product page', (await badges(product)).length, 1);
  check('product badge reads per fl oz across the 3-pack', (await badges(product))[0], '$0.26 / fl oz');
  check('badge sits next to the price', await product.$eval('.rup-badge', (b) =>
    b.previousElementSibling?.classList.contains('a-price')), true);
  check('badge is styled by the extension stylesheet', await product.$eval('.rup-badge', (b) =>
    getComputedStyle(b).borderRadius), '10px');
  await product.close();

  /* -- search page -- */
  const search = await context.newPage();
  await search.goto('https://www.amazon.com/s?k=peanut+butter');
  await search.waitForSelector('.rup-badge', { timeout: 10000 });
  await search.waitForSelector('.rup-best', { timeout: 10000 });

  console.log('\nsearch page');
  check('2-Pack, 40 oz', await badgeForAsin(search, 'B000A1'), '$0.16 / oz');
  check('16.3 oz', await badgeForAsin(search, 'B000A2'), '$0.21 / oz');
  check('1.5 lbs', await badgeForAsin(search, 'B000A3'), '$0.20 / oz');
  check('2 lb', await badgeForAsin(search, 'B000A4'), '$0.19 / oz');
  check('12 x 16 fl oz', await badgeForAsin(search, 'B000A5'), '$0.057 / fl oz');
  check('500g', await badgeForAsin(search, 'B000A6'), '$2.00 / 100 g');
  check('Pack of 6', await badgeForAsin(search, 'B000A7'), '$1.49 / ct');
  check('1000mg / 100 Count', await badgeForAsin(search, 'B000A8'), '$0.12 / ct');
  check('no readable size -> no badge', await badgeForAsin(search, 'B000A9'), null);
  check('no readable price -> no badge', await badgeForAsin(search, 'B000A10'), null);
  check('badge count on search page', (await badges(search)).length, 8);

  check('exactly one best-value tag', await search.$$eval('.rup-best', (e) => e.length), 1);
  check('best value goes to the cheapest per-oz item', await search.$eval('.rup-best', (t) =>
    t.closest('[data-component-type="s-search-result"]').dataset.asin), 'B000A1');

  // Re-running must not duplicate anything (the MutationObserver does this a lot).
  await search.evaluate(() => document.body.appendChild(document.createElement('div')));
  await search.waitForTimeout(600);
  check('idempotent: badge count unchanged after re-run', (await badges(search)).length, 8);
  check('idempotent: one best-value tag after re-run', await search.$$eval('.rup-best', (e) => e.length), 1);

  /* -- frozen pizza page: the compound-weight regression, end to end -- */
  const pizza = await context.newPage();
  await pizza.goto('https://www.amazon.com/s/pizza?k=frozen+pizza');
  await pizza.waitForSelector('.rup-best', { timeout: 10000 });

  console.log('\nfrozen pizza page (compound weights)');
  check('Stone Oven 1 lb 11.5 oz at $7.99', await badgeForAsin(pizza, 'BPZ001'), '$0.29 / oz');
  check('Pepperoni 24 oz at $8.49', await badgeForAsin(pizza, 'BPZ002'), '$0.35 / oz');
  check('Thin Crust 1 lb 4.6 oz at $6.99', await badgeForAsin(pizza, 'BPZ003'), '$0.34 / oz');
  check('best value goes to Stone Oven, not the pepperoni',
    await pizza.$eval('.rup-best', (t) =>
      t.closest('[data-component-type="s-search-result"]').dataset.asin), 'BPZ001');
  check('only one best-value tag on the pizza page',
    await pizza.$$eval('.rup-best', (e) => e.length), 1);
  await pizza.close();

  console.log('\nprivacy');
  check('no requests outside the page itself', offSite, []);
} finally {
  if (context) await context.close();
  rmSync(profile, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
