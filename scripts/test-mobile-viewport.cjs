/**
 * Chromium regression check for mobile horizontal overflow on Browse.
 * Intentional horizontal carousels (such as category chips) are excluded from
 * per-element bounds checks; the page shell and ordinary content must fit.
 */
const { chromium } = require('/tmp/mudaala-browser-test/node_modules/playwright');

const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const widths = [320, 360, 375, 390, 414, 640];
const height = 844;
const tolerance = 1;

async function inspectBrowse(browser, width) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();

  try {
    await page.goto(base + '/#/browse', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('main h1, main h2').first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden' &&
          style.position !== 'fixed' && style.position !== 'absolute';
      };
      const hasHorizontalScrollAncestor = element => {
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
          const style = getComputedStyle(ancestor);
          if (/(auto|scroll)/.test(style.overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 1) return true;
          ancestor = ancestor.parentElement;
        }
        return false;
      };
      const selectors = [
        'main', '.mudaala-page', '.mudaala-page--browse',
        'main *'
      ];
      const checked = new Set();
      const elements = [];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (checked.has(element) || !visible(element)) continue;
          checked.add(element);
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const horizontalScroller = /(auto|scroll)/.test(style.overflowX) &&
            element.scrollWidth > element.clientWidth + 1;
          elements.push({
            selector,
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
            text: (element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 90),
            left: Math.round(rect.left * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            internalOverflow: !horizontalScroller && element.scrollWidth > element.clientWidth + 1,
            horizontalScroller,
            position: style.position,
            inHorizontalScroller: hasHorizontalScrollAncestor(element),
          });
        }
      }
      const main = document.querySelector('main');
      return {
        viewportWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        mainClientWidth: main?.clientWidth ?? null,
        mainScrollWidth: main?.scrollWidth ?? null,
        hash: window.location.hash,
        headings: Array.from(document.querySelectorAll('main h1, main h2')).map(el => (el.innerText || '').trim()).filter(Boolean).slice(0, 10),
        elements,
      };
    });

    const offenders = result.elements.filter(element =>
      !element.inHorizontalScroller &&
      (element.right > result.viewportWidth + tolerance ||
        element.left < -tolerance ||
        element.internalOverflow)
    ).sort((a, b) =>
      Number(b.internalOverflow) - Number(a.internalOverflow) ||
      (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth)
    );
    const shellOverflow = result.mainScrollWidth !== null &&
      result.mainScrollWidth > result.mainClientWidth + tolerance;
    if (offenders.length || shellOverflow) {
      throw new Error(JSON.stringify({
        viewport: width,
        shellOverflow,
        offenders: offenders.slice(0, 30),
        document: {
          clientWidth: result.documentClientWidth,
          scrollWidth: result.documentScrollWidth,
          bodyClientWidth: result.bodyClientWidth,
          bodyScrollWidth: result.bodyScrollWidth,
          mainClientWidth: result.mainClientWidth,
          mainScrollWidth: result.mainScrollWidth,
          hash: result.hash,
          headings: result.headings,
        },
      }, null, 2));
    }

    console.log(JSON.stringify({
      viewport: width,
      result: 'pass',
      documentWidth: result.documentScrollWidth,
      mainWidth: result.mainScrollWidth,
      checkedElements: result.elements.length,
      route: result.hash,
    }));
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of widths) await inspectBrowse(browser, width);
    console.log('Mobile viewport overflow regression check passed for all widths.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error('Mobile viewport overflow regression check failed:', error.stack || error);
  process.exitCode = 1;
});
