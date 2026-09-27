# Real Unit Price

A Chrome extension (Manifest V3) that shows what you're *actually* paying while
you shop on Amazon. It reads the price and the package size already printed on
the page and puts a small badge next to the price:

```
$14.97  [ $0.26 / fl oz ]
```

On search results every item with a readable size gets a badge, and the cheapest
comparable item gets a **best value** tag.

## Install (Load unpacked)

1. Clone or download this folder.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder (the one containing
   `manifest.json`).
5. Open any Amazon product page or search results page. Badges appear next to
   prices.

To pick up code changes, hit the reload arrow on the extension card in
`chrome://extensions`, then refresh the Amazon tab.

## Screenshots

_Placeholder — drop images into `docs/` and link them here._

| | |
|---|---|
| **Product page** | `docs/screenshot-product.png` |
| **Search results with best value tag** | `docs/screenshot-search.png` |

<!--
![Product page](docs/screenshot-product.png)
![Search results](docs/screenshot-search.png)
-->

## What it reads, and what it refuses to guess

Units are normalised inside their own family, and reported in the unit you'd
actually compare on:

| On the page | Badge |
|---|---|
| `19.4 fl oz (Pack of 3)` | `$0.26 / fl oz` |
| `2-Pack, 40 oz Jars` | `$0.16 / oz` |
| `12 x 16 fl oz cans` | `$0.057 / fl oz` |
| `1.5 lbs` / `2 lb` | `$0.20 / oz` |
| `500g` / `2 x 1.36 kg` | `$2.00 / 100 g` |
| `1 L` | `$0.30 / 100 ml` |
| `1 lb 11.5 oz` | `$0.29 / oz` |
| `Pack of 6` / `100 Count` | `$1.49 / ct` |

Traps it handles deliberately:

- **`fl oz` vs `oz`** — matched longest-first, so fluid ounces are never
  silently treated as weight.
- **`lb` / `lbs` / `pound` / `pounds`** — all converted to ounces.
- **Pack multipliers** — `2-Pack`, `Pack of 6`, `12 x 16 fl oz`, and the
  reversed `16 fl oz x 12`. An `N x M unit` form wins outright, because it
  already binds the multiplier to the quantity; a pack term is never applied on
  top of it.
- **`24 Count, 16.9 Fl Oz`** — the count is the pack size, the fl oz is the
  per-bottle amount, so the total is 405.6 fl oz. With no measured unit present,
  a count *is* the size.
- **`1000mg`** — a per-serving dose, not a package size. Milligrams are never
  read as a package size, so a bottle of vitamins prices per `ct`.
- **Compound weights** — `1 lb 11.5 oz` is *one* size (27.5 oz), not a pound
  with a stray number after it. Also `1 Pound 4 Ounce`, `1 kg 500 g`,
  `2 liters 500 ml`. Only a directly adjacent, same-family, strictly-smaller
  unit is absorbed, so `3 oz 2 oz` and `1 lb, 4 Pack` are left alone.
- **`10.5 x 4 x 3 inches`** — shipping dimensions, not a multiplier.
- **`NET WT 20 OZ (1 LB 4 OZ)`** — a bracketed restatement of the same weight.
  The primary unit wins; the parenthetical is ignored rather than added on.
  Same for `Net Wt 12 oz (340 g)`.

**If the size cannot be read, no badge is shown.** A wrong unit price is worse
than none, so every ambiguous case returns nothing.

### "Best value"

Comparing `$/oz` against `$/ct` is meaningless, so the tag is awarded inside the
largest group of like-united results currently on screen, and only when there
are at least two of them to compare.

## Privacy

- **No network requests.** Nothing is fetched, and the test suite asserts that
  zero off-page requests are made.
- **No tracking, no storage.** There is no background service worker, no
  `storage`, and no analytics.
- **No permissions.** The manifest declares no `permissions` and no
  `host_permissions` — only `content_scripts.matches` for Amazon pages, which is
  the minimum needed to run there. Everything happens in the content script.

## Layout

```
manifest.json         MV3 manifest; content script only
src/parse.js          pure parsing: units, pack multipliers, price text
src/content.js        DOM layer: find price + size, render badge, best value
src/badge.css         badge styling
fixtures/product.html realistic Amazon product page
fixtures/search.html  realistic Amazon search page (10 results, incl. traps)
fixtures/bug-pizza.html  frozen pizza results: compound lb+oz weights
test.mjs              Playwright + pure-parser tests
```

`src/parse.js` holds no DOM and no state, which is why the parser cases in
`test.mjs` can run directly in Node.

## Tests

```bash
npm install
npm test          # HEADED=1 npm test to watch the browser
```

61 assertions in two layers:

1. **Parser** — 36 cases run straight against `src/parse.js` in Node, covering
   every trap above.
2. **End-to-end** — a real Chromium loads the unpacked extension, every request
   to `amazon.com` is fulfilled from the local fixtures (so the content script's
   URL match fires for real), and the rendered badges are asserted: 8 unit-price
   cases on the search page, the multipack product page, the frozen-pizza page
   (compound weights), the two show-nothing cases, best-value placement, re-run
   idempotency, and zero network requests.

## Known limits

- Amazon only (`.com`, `.co.uk`, `.ca`). Other retailers would need their own
  selectors.
- Size comes from the title first, since that is the only place a pack
  multiplier reliably appears. A title that mentions an unrelated size
  ("fits 12 oz cans") can mislead it.
- Price ranges (`$10.00 - $14.00`) are read from the lower bound.
