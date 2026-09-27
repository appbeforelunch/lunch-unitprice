Build me a Chrome extension (Manifest V3) that shows the real unit price while I shop online.
- On Amazon product pages and Amazon search results, read the price and the package size from the page (ounces, pounds, fluid ounces, count, grams, ml) and show a small badge next to the price: "$0.42 / oz" (or "/ ct", "/ 100 g"). If the size cannot be read, show nothing rather than guessing.
- On search results, add the same badge under every result that has a readable size, and a small "best value" tag on the cheapest per-unit item visible.
- Handle the common traps: "2-Pack", "Pack of 6", "12 x 16 fl oz", ounces vs fluid ounces, and pounds written as "lb" or "lbs".
- No network requests, no tracking, no permissions beyond the Amazon pages. Everything runs in the content script.
- Include a test file (test.mjs, Playwright) that loads the extension and runs it against saved HTML fixtures of an Amazon product page and a search page (write the fixtures yourself from realistic markup), checking at least 8 unit-price cases including the traps above. Run the tests in the foreground and wait for them.
- Include a README with install steps (Load unpacked) and a screenshot section placeholder.
