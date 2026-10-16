/**
 * Browser-level checks for two high-value journeys:
 * 1) Saved search: create in Browse -> read after navigation/reload -> apply -> remove.
 * 2) Mobile cart: add a real public offer -> open/close cart -> reach Post while signed out.
 *
 * Runs only against the disposable CI PostgreSQL database and local Next server.
 */
const { chromium } = require('/tmp/mudaala-browser-test/node_modules/playwright');

const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const timeout = 20000;

function uniquePhone() {
  return '+2567' + String(Math.floor(10000000 + Math.random() * 89999999));
}

async function verifySavedSearch(browser) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const phone = uniquePhone();
  const searchName = 'Browser persistence ' + Date.now();

  try {
    const registration = await context.request.post(base + '/api/auth/register', {
      data: {
        phone,
        name: 'Browser Saved Search Tester',
        password: 'password321',
        country: 'UG',
        acceptTerms: true,
      },
      headers: { origin: base, referer: base + '/' },
      timeout,
    });
    if (registration.status() !== 201) {
      throw new Error('Could not create disposable browser-test account: HTTP ' + registration.status() + ' ' + (await registration.text()).slice(0, 200));
    }

    await page.goto(base + '/#/browse', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for the cookie-backed session query before touching Save search;
    // otherwise the test could race the auth check and open the sign-in dialog.
    await page.getByRole('button', { name: /Browser Saved Search Tester/ }).waitFor({ state: 'visible', timeout });
    const saveButton = page.getByRole('button', { name: /save (this )?search/i });
    try {
      await saveButton.waitFor({ state: 'visible', timeout });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(el => el.textContent?.trim()).filter(Boolean),
        buttons: Array.from(document.querySelectorAll('button')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).map(el => ({ text: el.innerText.trim(), ariaLabel: el.getAttribute('aria-label'), disabled: el.disabled })).slice(0, 60),
        bodyText: document.body.innerText.slice(0, 2500),
      }));
      console.error('Saved-search browser diagnostic:', JSON.stringify(diagnostics, null, 2));
      throw error;
    }
    try {
      // Keep the failure bounded and capture the actual hit target. A visible
      // button can still be blocked by a transparent overlay or another layer.
      await saveButton.click({ timeout: 6000 });
    } catch (error) {
      const diagnostics = await saveButton.evaluateAll((buttons) => buttons.map((el) => {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          text: el.innerText.trim(),
          ariaLabel: el.getAttribute('aria-label'),
          disabled: el.disabled,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          pointerEvents: getComputedStyle(el).pointerEvents,
          hitTarget: hit ? {
            tag: hit.tagName,
            text: (hit.textContent || '').trim().slice(0, 160),
            ariaLabel: hit.getAttribute('aria-label'),
            className: typeof hit.className === 'string' ? hit.className.slice(0, 240) : '',
          } : null,
          url: window.location.href,
          bodyText: document.body.innerText.slice(0, 1800),
        };
      }));
      console.error('Saved-search click diagnostic:', JSON.stringify(diagnostics, null, 2));
      throw error;
    }

    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout });
    await dialog.getByLabel('Search name').fill(searchName);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    // The user-visible toast is not the proof. Verify the stored record through
    // the actual Saved searches page, then refresh to prove persistence.
    await page.goto(base + '/#/saved', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: /saved searches/i }).waitFor({ state: 'visible', timeout });
    await page.getByText(searchName, { exact: true }).waitFor({ state: 'visible', timeout });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByText(searchName, { exact: true }).waitFor({ state: 'visible', timeout });

    const row = page.locator('div.rounded-lg.border.bg-card.p-4').filter({ hasText: searchName });
    await row.getByRole('button', { name: /apply/i }).click();
    await page.waitForFunction(() => window.location.hash === '#/browse', null, { timeout });

    await page.goto(base + '/#/saved', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const savedRow = page.locator('div.rounded-lg.border.bg-card.p-4').filter({ hasText: searchName });
    await savedRow.getByRole('button', { name: /remove/i }).click();
    await page.getByText(searchName, { exact: true }).waitFor({ state: 'detached', timeout });

    // Revisit after deletion; a local-only optimistic update must not pass.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByText(searchName, { exact: true }).waitFor({ state: 'detached', timeout });

    console.log(JSON.stringify({
      savedSearchUI: 'pass',
      create: 'visible in Saved searches',
      reload: 'record persisted',
      apply: 'returned to Browse',
      remove: 'absent after reload',
    }, null, 2));
  } finally {
    await context.close();
  }
}

async function verifyMobileCart(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    const offersResponse = await fetch(base + '/api/listings?type=OFFER&page=1&pageSize=10', {
      headers: { accept: 'application/json' },
    });
    if (!offersResponse.ok) throw new Error('Could not load public offers for mobile cart verification: HTTP ' + offersResponse.status);
    const payload = await offersResponse.json();
    const offer = Array.isArray(payload.items) ? payload.items.find(item => item.type === 'OFFER') : null;
    if (!offer) throw new Error('No active offer is available for mobile cart verification');

    await page.goto(base + '/#/listing/' + encodeURIComponent(offer.id), {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.getByRole('button', { name: /add to cart/i }).click();
    const cartBar = page.locator('button[aria-controls="cart-mobile-sheet"]');
    await cartBar.waitFor({ state: 'visible', timeout });
    await cartBar.click({ timeout });
    const cartSheet = page.locator('#cart-mobile-sheet');
    await cartSheet.waitFor({ state: 'visible', timeout });
    await cartSheet.getByRole('button', { name: /close the cart/i }).click();
    await cartSheet.waitFor({ state: 'hidden', timeout });

    const post = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Post' });
    await post.waitFor({ state: 'visible', timeout });
    await post.click({ timeout });
    await page.waitForFunction(() => window.location.hash === '#/publish', null, { timeout });
    await page.getByRole('heading', { name: /sign in to post an ad/i }).waitFor({ state: 'visible', timeout });

    console.log(JSON.stringify({
      mobileCart: 'pass',
      cart: 'opened and closed by real clicks',
      post: 'reachable after cart dismissal',
      signedOutGuard: 'publish sign-in requirement shown',
    }, null, 2));
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await verifySavedSearch(browser);
    await verifyMobileCart(browser);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
