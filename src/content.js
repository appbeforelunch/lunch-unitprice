/*
 * Real Unit Price - DOM layer.
 *
 * Finds prices and package sizes already present on the page, computes a unit
 * price, and renders a badge. Reads nothing off the network and stores nothing.
 */
(function () {
  'use strict';

  var UP = globalThis.UnitPrice;
  var BADGE_CLASS = 'rup-badge';
  var BEST_CLASS = 'rup-best';
  var DONE_ATTR = 'data-rup-done';

  /* ----------------------------------------------------------- DOM helpers - */

  function text(el) {
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function firstText(root, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      var t = text(el);
      if (t) return t;
    }
    return '';
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  /* -------------------------------------------------------------- pricing - */

  var PRICE_SELECTORS = [
    '#corePrice_feature_div .a-price .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#apex_desktop .a-price .a-offscreen',
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-color-price'
  ];

  // Amazon renders the visible price as whole + fraction spans and duplicates it
  // into an .a-offscreen span for screen readers. Prefer the offscreen copy;
  // fall back to reassembling the split spans.
  function readPrice(scope) {
    var t = firstText(scope, PRICE_SELECTORS);
    var price = UP.parsePrice(t);
    if (price !== null) return { value: price, node: scope.querySelector('.a-price') };

    var whole = scope.querySelector('.a-price-whole');
    var frac = scope.querySelector('.a-price-fraction');
    if (whole) {
      var joined = text(whole).replace(/[^\d,]/g, '') + '.' + (text(frac).replace(/\D/g, '') || '00');
      price = UP.parsePrice(joined);
      if (price !== null) return { value: price, node: whole.closest('.a-price') || whole };
    }
    return null;
  }

  /* ----------------------------------------------------------------- size - */

  // Product-detail rows that actually describe the package, in trust order.
  var DETAIL_KEYS = [
    'net content volume', 'unit count', 'item volume', 'item weight',
    'net weight', 'size', 'package quantity', 'number of items'
  ];

  function detailRowSizes(doc) {
    var out = [];
    var rows = doc.querySelectorAll(
      '#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr,' +
      '#detailBullets_feature_div li, .prodDetTable tr, #technicalSpecifications_section_1 tr'
    );
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var label = text(row.querySelector('th, .a-text-bold'));
      var value = text(row.querySelector('td, .a-list-item span:not(.a-text-bold)'));
      if (!label) {
        // detail bullets sometimes collapse into a single "Label : Value" span
        var whole = text(row);
        var split = whole.split(/\s*[::]\s*/);
        if (split.length >= 2) { label = split[0]; value = split.slice(1).join(' '); }
      }
      label = label.replace(/[::‎‏]/g, '').trim().toLowerCase();
      if (!label || !value) continue;
      var rank = DETAIL_KEYS.indexOf(label);
      if (rank === -1) continue;
      out.push({ rank: rank, text: value });
    }
    out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  /**
   * Product page size. The title is tried first because it is the only place a
   * pack multiplier reliably appears ("16.9 Fl Oz (Pack of 24)"); detail rows
   * describe a single unit and would silently understate a multipack.
   */
  function readProductSize(doc) {
    var candidates = [];
    var title = text(doc.querySelector('#productTitle'));
    if (title) candidates.push(title);

    var selected = firstText(doc, [
      '#variation_size_name .selection',
      '#variation_item_form_factor .selection',
      '#inline-twister-expanded-dimension-text-size_name'
    ]);
    if (selected) candidates.push(selected);

    detailRowSizes(doc).forEach(function (r) { candidates.push(r.text); });

    var bullets = doc.querySelector('#feature-bullets');
    if (bullets) candidates.push(text(bullets));

    for (var i = 0; i < candidates.length; i++) {
      var size = UP.parseSize(candidates[i]);
      if (size) return size;
    }
    return null;
  }

  /** Search-result size: the result title, then any size row Amazon shows. */
  function readResultSize(card) {
    var candidates = [];
    var title = firstText(card, [
      'h2 span', 'h2 a span', '[data-cy="title-recipe"] h2', '.s-title-instructions-style span'
    ]);
    if (title) candidates.push(title);

    var extra = card.querySelectorAll('.s-size-base, .a-size-base, .a-text-normal');
    for (var i = 0; i < extra.length && candidates.length < 8; i++) {
      var t = text(extra[i]);
      if (t && t.length < 120) candidates.push(t);
    }

    for (var j = 0; j < candidates.length; j++) {
      var size = UP.parseSize(candidates[j]);
      if (size) return size;
    }
    return null;
  }

  /* --------------------------------------------------------------- render - */

  function makeBadge(unit) {
    var span = document.createElement('span');
    span.className = BADGE_CLASS;
    span.textContent = unit.text;
    span.setAttribute('data-rup-value', String(unit.value));
    span.setAttribute('data-rup-unit', unit.unitLabel);
    span.title = 'Real Unit Price: computed from the price and package size on this page';
    return span;
  }

  function attach(anchor, unit) {
    if (!anchor) return null;
    var badge = makeBadge(unit);
    if (anchor.parentNode) anchor.parentNode.insertBefore(badge, anchor.nextSibling);
    else anchor.appendChild(badge);
    return badge;
  }

  /* --------------------------------------------------------- page handlers - */

  function runProductPage() {
    var host = document.querySelector('#corePrice_feature_div, #corePriceDisplay_desktop_feature_div, #apex_desktop, #price');
    if (!host || host.getAttribute(DONE_ATTR)) return;

    var price = readPrice(host) || readPrice(document);
    if (!price) return;                      // price not painted yet - retry later
    var size = readProductSize(document);
    // Whether a size is readable is settled once the title exists, so a miss is
    // recorded as final rather than retried on every mutation.
    host.setAttribute(DONE_ATTR, '1');
    if (!size) return;                       // unreadable size -> show nothing
    var unit = UP.formatUnitPrice(price.value, size);
    if (!unit) return;
    attach(price.node || host.firstElementChild || host, unit);
  }

  var RESULT_SELECTOR = '[data-component-type="s-search-result"]';

  function runSearchPage() {
    var cards = document.querySelectorAll(RESULT_SELECTOR);
    if (!cards.length) return;

    var scored = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var existing = card.querySelector('.' + BADGE_CLASS);
      if (!existing) {
        if (card.getAttribute(DONE_ATTR)) continue;
        var price = readPrice(card);
        if (!price) continue;                // price not painted yet - retry later
        var size = readResultSize(card);
        card.setAttribute(DONE_ATTR, '1');
        if (!size) continue;                 // unreadable size -> show nothing
        var unit = UP.formatUnitPrice(price.value, size);
        if (!unit) continue;
        existing = attach(price.node || card, unit);
        if (!existing) continue;
      }
      if (!isVisible(card)) continue;
      scored.push({
        card: card,
        badge: existing,
        unitLabel: existing.getAttribute('data-rup-unit'),
        value: parseFloat(existing.getAttribute('data-rup-value'))
      });
    }
    markBestValue(scored);
  }

  /**
   * "Best value" is only meaningful between comparable units - $/oz against
   * $/ct says nothing. So the tag goes to the cheapest item within the largest
   * group of like-united results on screen, and only when there is something to
   * compare it against.
   *
   * Idempotent on purpose: this runs from a MutationObserver, so re-inserting an
   * identical tag would retrigger the observer forever.
   */
  function markBestValue(scored) {
    var groups = {};
    scored.forEach(function (s) {
      if (!isFinite(s.value)) return;
      (groups[s.unitLabel] = groups[s.unitLabel] || []).push(s);
    });

    var winner = null;
    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      if (group.length < 2) return;
      if (winner && groups[winner.unitLabel].length >= group.length) return;
      winner = group.reduce(function (a, b) { return b.value < a.value ? b : a; });
    });

    var tags = document.querySelectorAll('.' + BEST_CLASS);
    var placed = winner && winner.badge.nextElementSibling;
    if (tags.length === 1 && placed && placed.classList.contains(BEST_CLASS)) return;

    for (var i = 0; i < tags.length; i++) tags[i].remove();
    if (!winner) return;
    var tag = document.createElement('span');
    tag.className = BEST_CLASS;
    tag.textContent = 'best value';
    winner.badge.parentNode.insertBefore(tag, winner.badge.nextSibling);
  }

  /* ------------------------------------------------------------------ boot - */

  function run() {
    try {
      runSearchPage();
      runProductPage();
    } catch (err) {
      // Never let a layout surprise break the host page.
      if (globalThis.__RUP_DEBUG) console.error('[unit-price]', err);
    }
  }

  run();

  // Amazon paints search results and price blocks in late, and swaps them on
  // variation clicks. Re-run on a debounce; DONE_ATTR keeps it idempotent.
  var pending = null;
  var observer = new MutationObserver(function () {
    if (pending) return;
    pending = setTimeout(function () { pending = null; run(); }, 150);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  globalThis.__unitPriceRun = run;   // test hook
})();
