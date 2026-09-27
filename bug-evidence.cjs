require('/Users/demo/Documents/Personal-Projects/lunch-unitprice/src/parse.js');
const U=globalThis.UnitPrice;
for (const [t,p] of [
 ['NET WT 20 OZ (1 LB 4 OZ) 567g',5],
 ['Net Wt 1 lb 4 oz',5],
 ['1 Pound 4 Ounce',5],
 ['1 lb 8 oz bag',6],
 ['2 lb 3 oz',7],
 ['Ground Beef, 1.25 lb',6.24],
 ['Chicken Breast, 2 lb 6 oz package',9.49],
 ['Frozen Pizza, 1 lb 11.5 oz',7.99],
]) { const b=U.unitPrice('$'+p.toFixed(2),t); console.log(t.padEnd(36), '$'+p, '=>', b&&b.text, ' size', JSON.stringify(U.parseSize(t)&&U.parseSize(t).amount)); }
