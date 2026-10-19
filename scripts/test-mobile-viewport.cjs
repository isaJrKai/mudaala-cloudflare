/**
 * Regression check for mobile horizontal overflow on Mudaala's Browse view.
 * Runs against the disposable CI database and local Next.js server.
 */
const { chromium } = require('/tmp/mudaala-browser-test/node_modules/playwright');

const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const widths = [320, 360, 375, 390, 414, 640];
const height = 844;
const tolerance = 1;

async function inspectBrowse(browser, width) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto(base + '/#/browse', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(900);

    const result = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden' &&
          style.position !== 'fixed' && style.position !== 'absolute';
      };
      const selectors = [
        'html', 'body', 'main', '.mudaala-page',
        '.mudaala-page--browse',
        'main article', 'main button', 'main input', 'main select',
        'main textarea', 'main [role="search"]', 'main [role="searchbox"]',
        'main [class*="grid"]'
      ];
      const checked = new Set();
      const elements = [];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          if (checked.has(element) || !visible(element)) continue;
          checked.add(element);
          const rect = element.getBoundingClientRect();
          elements.push({
            selector,
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
            text: (element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 90),
            left: Math.round(rect.left * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            position: getComputedStyle(element).position,
          });
        }
      }
      return {
        viewportWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        hash: window.location.hash,
        title: document.title,
        headings: Array.from(document.querySelectorAll('main h1, main h2')).map(el => (el.innerText || '').trim()).filter(Boolean).slice(0, 10),
        elements,
      };
    });

    const offenders = result.elements.filter(element =>
      element.right > result.viewportWidth + tolerance || element.left < -tolerance
    );
    const widthOverflow = result.documentScrollWidth > result.documentClientWidth + tolerance ||
      result.bodyScrollWidth > result.bodyClientWidth + tolerance;
    if (widthOverflow || offenders.length || errors.length) {
      throw new Error(JSON.stringify({
        viewport: width,
        widthOverflow,
        offenders: offenders.slice(0, 30),
        document: {
          clientWidth: result.documentClientWidth,
          scrollWidth: result.documentScrollWidth,
          bodyClientWidth: result.bodyClientWidth,
          bodyScrollWidth: result.bodyScrollWidth,
          hash: result.hash,
          headings: result.headings,
        },
        pageErrors: errors,
      }, null, 2));
    }

    console.log(JSON.stringify({
      viewport: width,
      result: 'pass',
      documentWidth: result.documentScrollWidth,
      bodyWidth: result.bodyScrollWidth,
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
