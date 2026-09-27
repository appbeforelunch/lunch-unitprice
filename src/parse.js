/*
 * Real Unit Price - pure parsing layer.
 *
 * No DOM, no network, no state. Everything here is a pure function so it can be
 * exercised directly from the test file as well as from the content script.
 *
 * Exposed as globalThis.UnitPrice (classic script, no modules - content scripts
 * are plain scripts sharing one isolated-world global).
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- units - */

  // Each family has a base unit and a display step. `amount` in a parsed size
  // is always expressed in display steps, so unitPrice = price / amount.
  var FAMILIES = {
    weightImperial: { base: 'oz', step: 1, label: 'oz' },
    weightMetric: { base: 'g', step: 100, label: '100 g' },
    volumeImperial: { base: 'fl oz', step: 1, label: 'fl oz' },
    volumeMetric: { base: 'ml', step: 100, label: '100 ml' },
    count: { base: 'ct', step: 1, label: 'ct' }
  };

  // unit spelling -> [family, how many base units one of it is worth]
  // Order is irrelevant here; the regex alternation below is length-sorted so
  // that "fl oz" always wins over "oz".
  var UNITS = {
    // volume, imperial. Listed first for readability; longest-match handles it.
    'fl oz': ['volumeImperial', 1],
    'fl ozs': ['volumeImperial', 1],
    'floz': ['volumeImperial', 1],
    'fluid oz': ['volumeImperial', 1],
    'fluid ounce': ['volumeImperial', 1],
    'fluid ounces': ['volumeImperial', 1],
    'pt': ['volumeImperial', 16],
    'pint': ['volumeImperial', 16],
    'pints': ['volumeImperial', 16],
    'qt': ['volumeImperial', 32],
    'quart': ['volumeImperial', 32],
    'quarts': ['volumeImperial', 32],
    'gal': ['volumeImperial', 128],
    'gallon': ['volumeImperial', 128],
    'gallons': ['volumeImperial', 128],

    // volume, metric
    'ml': ['volumeMetric', 1],
    'mls': ['volumeMetric', 1],
    'milliliter': ['volumeMetric', 1],
    'milliliters': ['volumeMetric', 1],
    'millilitre': ['volumeMetric', 1],
    'millilitres': ['volumeMetric', 1],
    'cl': ['volumeMetric', 10],
    'l': ['volumeMetric', 1000],
    'liter': ['volumeMetric', 1000],
    'liters': ['volumeMetric', 1000],
    'litre': ['volumeMetric', 1000],
    'litres': ['volumeMetric', 1000],

    // weight, imperial
    'oz': ['weightImperial', 1],
    'ozs': ['weightImperial', 1],
    'ounce': ['weightImperial', 1],
    'ounces': ['weightImperial', 1],
    'lb': ['weightImperial', 16],
    'lbs': ['weightImperial', 16],
    'pound': ['weightImperial', 16],
    'pounds': ['weightImperial', 16],

    // weight, metric. Note: mg is deliberately absent - on Amazon "1000mg" is
    // almost always a per-serving dose, not a package size, and treating it as
    // one produces nonsense like "$0.04 / 100 g" for a bottle of vitamins.
    'g': ['weightMetric', 1],
    'gr': ['weightMetric', 1],
    'gram': ['weightMetric', 1],
    'grams': ['weightMetric', 1],
    'gramme': ['weightMetric', 1],
    'grammes': ['weightMetric', 1],
    'kg': ['weightMetric', 1000],
    'kgs': ['weightMetric', 1000],
    'kilogram': ['weightMetric', 1000],
    'kilograms': ['weightMetric', 1000]
  };

  // Things that are a headcount rather than a measured amount.
  var COUNT_UNITS = [
    'ct', 'cts', 'count', 'counts', 'pieces', 'piece', 'pcs', 'pc',
    'capsules', 'capsule', 'caps', 'tablets', 'tablet', 'softgels', 'softgel',
    'gummies', 'bars', 'bags', 'sachets', 'packets', 'packet', 'pods', 'pod',
    'sheets', 'rolls', 'wipes', 'diapers', 'cans', 'bottles', 'boxes',
    'servings', 'teabags', 'k-cups', 'kcups', 'pairs', 'pair', 'units'
  ];

  function alternation(keys) {
    var sorted = keys.slice().sort(function (a, b) { return b.length - a.length; });
    return sorted.map(escapeRe).join('|');
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var MEASURED_ALT = alternation(Object.keys(UNITS));
  var COUNT_ALT = alternation(COUNT_UNITS);

  var NUM = '\\d+(?:\\.\\d+)?';

  // "16.9 fl oz"
  var RE_MEASURED = new RegExp('(' + NUM + ')\\s*(' + MEASURED_ALT + ')(?![a-z])', 'g');
  // "12 x 16 fl oz"
  var RE_X_FORWARD = new RegExp('(\\d+)\\s*x\\s*(' + NUM + ')\\s*(' + MEASURED_ALT + ')(?![a-z])');
  // "16 fl oz x 12"
  var RE_X_REVERSE = new RegExp('(' + NUM + ')\\s*(' + MEASURED_ALT + ')(?![a-z])\\s*x\\s*(\\d+)\\b');
  // "10.5 x 4 x 3 inches" - a shipping dimension, never a pack multiplier.
  var RE_DIMENSIONS = new RegExp('(' + NUM + ')\\s*x\\s*(' + NUM + ')\\s*x\\s*(' + NUM + ')');
  // "Pack of 6" / "2-Pack" / "2 pk"
  var RE_PACK_OF = /(?:pack|packs|pk|set|box|case)\s*(?:of|:)\s*(\d+)/;
  var RE_N_PACK = /(\d+)\s*-?\s*(?:pack|packs|pk)\b/;
  // "24 Count" / "60 capsules"
  var RE_COUNT = new RegExp('(\\d+)\\s*(' + COUNT_ALT + ')(?![a-z])');
  // The " 4 oz" tail of "1 lb 4 oz", anchored so it must directly follow.
  var RE_CONTINUE = new RegExp('^[\\s,]*(?:and\\s+)?(' + NUM + ')\\s*(' + MEASURED_ALT + ')(?![a-z])');

  /* ------------------------------------------------------------ normalize - */

  function normalize(text) {
    if (typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[    ]/g, ' ')
      .replace(/[×✕✖⨯]/g, 'x')
      .replace(/[‐-―−]/g, '-')
      // thousands separators: 1,000 ml -> 1000 ml
      .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
      // drop periods that are not decimal points, so "fl. oz." -> "fl oz"
      .replace(/\.(?!\d)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ----------------------------------------------------------- parsePrice - */

  // "$12.34", "$1,234.56", "12.34", "USD 9.99" -> Number, else null.
  function parsePrice(text) {
    if (typeof text !== 'string') return null;
    var cleaned = text.replace(/[  ]/g, ' ');
    // For a range ("$10.00 - $14.00") this takes the lower bound, which is the
    // figure Amazon leads with.
    var m = cleaned.match(/(?:\$|usd\s*)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
    if (!m) return null;
    var n = parseFloat(m[1].replace(/,/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  }

  /**
   * "1 lb 11.5 oz" is one size, not two - reading only the pounds understates
   * the package and overstates the unit price.
   *
   * Extends a measured match with any directly adjacent parts in the same family
   * whose unit is strictly smaller, and returns the extra amount in base units.
   * Two guards keep it honest: a bracket or any other character between the
   * parts ("20 oz (1 lb 4 oz)") means the second reading is a restatement rather
   * than a continuation, and a non-decreasing unit ("12 oz ... 24 oz") means the
   * same amount stated twice. Both stop the walk.
   */
  function extendCompound(t, pos, family, lastFactor) {
    var extra = 0;
    for (;;) {
      var m = RE_CONTINUE.exec(t.slice(pos));
      if (!m) break;
      var spec = UNITS[m[2]];
      if (!spec || spec[0] !== family || spec[1] >= lastFactor) break;
      var part = parseFloat(m[1]);
      if (!isFinite(part) || part <= 0) break;
      extra += part * spec[1];
      lastFactor = spec[1];
      pos += m[0].length;
    }
    return extra;
  }

  /* ------------------------------------------------------------ parseSize - */

  /**
   * Read a package size out of free text.
   *
   * Returns { amount, unitLabel, family, totalBase, multiplier } where
   * `amount` is expressed in display steps (so 340 g -> 3.4 of "100 g"), or
   * null when nothing trustworthy is found. Guessing is never acceptable here:
   * a wrong unit price is worse than no unit price.
   */
  function parseSize(text) {
    var t = normalize(text);
    if (!t) return null;

    var multiplier = 1;
    var qty = null;
    var unitKey = null;

    // 1. "12 x 16 fl oz" binds multiplier and quantity together, so it wins
    //    outright - no pack term may be applied on top of it.
    var xm = RE_X_FORWARD.exec(t);
    var reversed = false;
    if (!xm) {
      xm = RE_X_REVERSE.exec(t);
      reversed = !!xm;
    }
    var dims = RE_DIMENSIONS.exec(t);
    if (xm && dims && dims.index <= xm.index) xm = null; // "10 x 4 x 3 inches"

    var unitEnd = -1;   // where the matched unit ends, for compound tails

    if (xm) {
      if (reversed) {
        qty = parseFloat(xm[1]);
        unitKey = xm[2];
        multiplier = parseInt(xm[3], 10);
      } else {
        multiplier = parseInt(xm[1], 10);
        qty = parseFloat(xm[2]);
        unitKey = xm[3];
        unitEnd = xm.index + xm[0].length;   // "12 x 1 lb 4 oz"
      }
    } else {
      // 2. First measured amount in the text ("Net Wt 12 oz (340 g)" -> 12 oz).
      RE_MEASURED.lastIndex = 0;
      var mm = RE_MEASURED.exec(t);
      // A bare "l" is an easy false positive inside stray text; nobody sells
      // groceries by the hundreds of litres, so cap it.
      while (mm && mm[2] === 'l' && parseFloat(mm[1]) > 20) {
        mm = RE_MEASURED.exec(t);
      }
      if (mm) {
        qty = parseFloat(mm[1]);
        unitKey = mm[2];
        unitEnd = mm.index + mm[0].length;
      }

      // 3. Pack multipliers.
      var pm = RE_PACK_OF.exec(t) || RE_N_PACK.exec(t);
      if (pm) {
        multiplier = parseInt(pm[1], 10);
      } else {
        // "24 Count, 16.9 Fl Oz" - the count is the pack size, the fl oz is
        // the per-bottle amount. With no measured unit, the count IS the size.
        var cm = RE_COUNT.exec(t);
        if (cm) {
          if (unitKey) {
            multiplier = parseInt(cm[1], 10);
          } else {
            qty = parseInt(cm[1], 10);
            unitKey = null;
            return finish(qty, 1, 'count');
          }
        }
      }
    }

    if (unitKey === null) {
      // No measured unit at all. A lone pack term is still a usable count.
      if (multiplier > 1) return finish(multiplier, 1, 'count');
      return null;
    }
    if (!isFinite(qty) || qty <= 0) return null;
    if (!isFinite(multiplier) || multiplier <= 0) return null;

    var spec = UNITS[unitKey];
    var baseQty = qty * spec[1];
    if (unitEnd >= 0) baseQty += extendCompound(t, unitEnd, spec[0], spec[1]);
    return finish(baseQty, multiplier, spec[0]);
  }

  function finish(baseQty, multiplier, family) {
    var fam = FAMILIES[family];
    var totalBase = baseQty * multiplier;
    if (!isFinite(totalBase) || totalBase <= 0) return null;
    return {
      amount: totalBase / fam.step,
      unitLabel: fam.label,
      family: family,
      totalBase: totalBase,
      multiplier: multiplier
    };
  }

  /* ------------------------------------------------------------ unitPrice - */

  function formatUnitPrice(price, size) {
    if (!size || !(price > 0)) return null;
    var value = price / size.amount;
    if (!isFinite(value) || value <= 0) return null;
    var decimals = value < 0.1 ? 3 : 2;
    return {
      value: value,
      unitLabel: size.unitLabel,
      text: '$' + value.toFixed(decimals) + ' / ' + size.unitLabel
    };
  }

  /** price text + size text -> { value, unitLabel, text } or null. */
  function unitPrice(priceText, sizeText) {
    var price = parsePrice(priceText);
    var size = parseSize(sizeText);
    if (price === null || size === null) return null;
    return formatUnitPrice(price, size);
  }

  globalThis.UnitPrice = {
    normalize: normalize,
    parsePrice: parsePrice,
    parseSize: parseSize,
    formatUnitPrice: formatUnitPrice,
    unitPrice: unitPrice,
    FAMILIES: FAMILIES
  };
})();
