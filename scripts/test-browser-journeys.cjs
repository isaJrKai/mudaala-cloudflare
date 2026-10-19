/**
 * Browser-level checks for two high-value journeys:
 * 1) Saved search: create in Browse -> read after navigation/reload -> apply -> remove.
 * 2) Mobile cart: add a real public offer -> open/close cart -> reach Post while signed out.
 *
 * Runs only against the disposable CI PostgreSQL database and local Next server.
 */
const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const timeout = 20000;

function uniquePhone() {
  return '+2567' + String(Math.floor(10000000 + Math.random() * 89999999));
}

async function verifySavedSearch(browser) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const phone = uniquePhone();
  const searchTerm = 'browser persistence ' + Date.now();
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

    // Register the profile-response waiter before navigation. A fresh user's
    // shop-setup query can resolve after the session button appears; checking
    // for the dialog too early lets it open underneath the test later.
    const profileResponsePromise = page.waitForResponse((response) => {
      return new URL(response.url()).pathname === '/api/profile';
    }, { timeout });
    await page.goto(base + '/#/browse', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for both the cookie-backed session and profile query before Save.
    await page.getByRole('button', { name: /Browser Saved Search Tester/ }).waitFor({ state: 'visible', timeout });
    const profileResponse = await profileResponsePromise;
    if (!profileResponse.ok()) {
      throw new Error('Browser-test profile request failed: HTTP ' + profileResponse.status());
    }
    await page.waitForTimeout(100); // allow React Query's response update to render

    // A brand-new account can legitimately receive the first-run Shop Setup
    // dialog. Dismiss it the same way a user can (not by bypassing the overlay)
    // before exercising the independent saved-search journey.
    const shopSetupDialog = page.getByRole('dialog').filter({ hasText: /Welcome to Mudaala/i });
    if (await shopSetupDialog.isVisible().catch(() => false)) {
      await shopSetupDialog.getByRole('button', { name: 'Later', exact: true }).click();
      await shopSetupDialog.waitFor({ state: 'hidden', timeout });
    }

    // Give the saved search meaningful filters so Apply is verified as a
    // state-restoring action, not merely a navigation to Browse.
    await page.getByRole('searchbox', { name: /search/i }).fill(searchTerm);
    await page.waitForTimeout(500); // matches the UI's 350 ms debounce

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
      const diagnostics = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"]'))
          .map(el => (el.textContent || '').trim()).filter(Boolean).slice(0, 30),
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]'))
          .map(el => ({ text: (el.textContent || '').trim().slice(0, 500), visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) })),
        buttons: Array.from(document.querySelectorAll('button')).map(el => {
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          return {
            text: (el.innerText || '').trim().slice(0, 120),
            ariaLabel: el.getAttribute('aria-label'),
            disabled: el.disabled,
            visible: rect.width > 0 && rect.height > 0,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            pointerEvents: getComputedStyle(el).pointerEvents,
            hitTarget: hit ? {
              tag: hit.tagName,
              text: (hit.textContent || '').trim().slice(0, 120),
              ariaLabel: hit.getAttribute('aria-label'),
              className: typeof hit.className === 'string' ? hit.className.slice(0, 180) : '',
            } : null,
          };
        }).filter(b => b.visible).slice(0, 80),
        bodyText: document.body.innerText.slice(0, 3000),
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
    await page.getByRole('searchbox', { name: /search/i }).waitFor({ state: 'visible', timeout });
    const appliedSearchTerm = await page.getByRole('searchbox', { name: /search/i }).inputValue();
    if (appliedSearchTerm !== searchTerm) {
      throw new Error(`Saved-search Apply did not restore the search term: expected "${searchTerm}", received "${appliedSearchTerm}"`);
    }

    await page.goto(base + '/#/saved', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const savedRow = page.locator('div.rounded-lg.border.bg-card.p-4').filter({ hasText: searchName });
    // Capture the actual delete response as well as the rendered outcome. This
    // makes a server/database failure distinguishable from a stale UI row.
    const deleteResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return request.method() === 'DELETE'
        && new URL(response.url()).pathname.startsWith('/api/saved-searches/');
    }, { timeout });
    await savedRow.getByRole('button', { name: /remove/i }).click();
    const deleteResponse = await deleteResponsePromise;
    const deleteBody = await deleteResponse.text();
    if (!deleteResponse.ok()) {
      throw new Error(`Saved-search deletion failed: HTTP ${deleteResponse.status()} ${deleteBody.slice(0, 500)}`);
    }
    await page.getByText('Saved search removed', { exact: true }).waitFor({ state: 'visible', timeout });
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

async function verifyListingLifecycle(browser) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const browserConsoleErrors = [];
  const browserPageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserConsoleErrors.push(message.text().slice(0, 500));
  });
  page.on('pageerror', (error) => browserPageErrors.push(String(error.message).slice(0, 500)));
  const phone = uniquePhone();
  const title = 'Browser lifecycle ' + Date.now();
  const editedTitle = title + ' edited';

  try {
    const registration = await context.request.post(base + '/api/auth/register', {
      data: {
        phone,
        name: 'Browser Listing Lifecycle Tester',
        password: 'password321',
        country: 'UG',
        acceptTerms: true,
      },
      headers: { origin: base, referer: base + '/' },
      timeout,
    });
    if (registration.status() !== 201) {
      throw new Error('Could not create listing-lifecycle account: HTTP ' + registration.status() + ' ' + (await registration.text()).slice(0, 200));
    }

    // Give this disposable seller a named shop so the public Browse rail can
    // render its QR code. This uses the same profile API as the seller form.
    const profileSave = await context.request.put(base + '/api/profile', {
      data: {
        businessName: 'Browser Lifecycle Shop',
        photoUrl: null,
        coverPhotoUrl: null,
        category: null,
        description: 'Temporary browser regression fixture for public shop QR rendering.',
        county: null,
        area: null,
        phone,
        whatsapp: null,
        hours: null,
      },
      headers: { origin: base, referer: base + '/' },
      timeout,
    });
    if (profileSave.status() !== 200) {
      throw new Error('Could not create disposable named shop profile: HTTP ' + profileSave.status());
    }

    const profileResponsePromise = page.waitForResponse((response) => {
      return new URL(response.url()).pathname === '/api/profile';
    }, { timeout });
    await page.goto(base + '/#/publish', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('button', { name: /Browser Listing Lifecycle Tester/ }).waitFor({ state: 'visible', timeout });
    const profileResponse = await profileResponsePromise;
    if (!profileResponse.ok()) throw new Error('Listing-lifecycle profile request failed: HTTP ' + profileResponse.status());
    await page.waitForTimeout(100);

    const setupDialog = page.getByRole('dialog').filter({ hasText: /Welcome to Mudaala/i });
    if (await setupDialog.isVisible().catch(() => false)) {
      await setupDialog.getByRole('button', { name: 'Later', exact: true }).click();
      await setupDialog.waitFor({ state: 'hidden', timeout });
    }

    await page.locator('#p-category').click();
    await page.getByRole('option', { name: /Scrap & Recyclables/i }).click();
    await page.locator('#p-title').fill(title);
    await page.locator('#p-desc').fill('Temporary regression fixture for listing creation, editing, and deletion.');
    await page.locator('#p-price').fill('20000');
    await page.locator('#p-unit').click();
    await page.getByRole('option', { name: /per kg/i }).click();
    await page.locator('#p-county').click();
    await page.getByRole('option', { name: /^Kampala$/i }).click();
    await page.locator('#p-phone').fill(phone);
    await page.locator('#p-wa').fill(phone);

    const photoTips = page.getByRole('note', { name: 'Tips for better listing photos' });
    await photoTips.waitFor({ state: 'visible', timeout });
    for (const tip of ['bright, even lighting', 'Show the whole item', 'simple background', 'different angles']) {
      if (!(await photoTips.innerText()).toLowerCase().includes(tip.toLowerCase())) {
        throw new Error('Listing photo guidance is missing the tip: ' + tip);
      }
    }

    // Upload two tiny, valid PNG fixtures through the actual photo picker so
    // this journey covers durable URL assignment and the product gallery.
    const galleryInput = page.locator('input[type="file"][accept="image/*"]:not([capture])');
    const photoOne = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZr8AAAAASUVORK5CYII=', 'base64');
    const photoTwo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
    await galleryInput.setInputFiles({ name: 'listing-photo-one.png', mimeType: 'image/png', buffer: photoOne });
    await page.waitForFunction(() => document.querySelectorAll('img[alt="Listing photo"]').length >= 1, null, { timeout });
    await galleryInput.setInputFiles({ name: 'listing-photo-two.png', mimeType: 'image/png', buffer: photoTwo });
    await page.waitForFunction(() => document.querySelectorAll('img[alt="Listing photo"]').length >= 2, null, { timeout });

    // Attach rejection handling immediately: otherwise the response wait can
    // time out while Playwright is still waiting for the Publish button click,
    // causing Node to report an unhandled rejection before diagnostics run.
    const createResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/listings';
    }, { timeout }).then(
      (response) => ({ response }),
      (error) => ({ error }),
    );
    let publishClickError;
    try {
      await page.locator('#p-title').locator('xpath=ancestor::form').getByRole('button', { name: /^Post ad$/i }).click({ timeout: 6000 });
    } catch (error) {
      publishClickError = error;
    }
    const createResult = await createResponsePromise;
    let createResponse;
    if (createResult.error) {
      // A form-level Zod rejection intentionally prevents the API request. If
      // the browser journey times out, capture the visible validation state so
      // the next CI run identifies the missing/invalid field instead of only
      // reporting a generic waitForResponse timeout.
      const diagnostics = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(el => (el.textContent || '').trim()).filter(Boolean),
        fields: Array.from(document.querySelectorAll('#p-title,#p-desc,#p-price,#p-compare,#p-qty,#p-phone,#p-wa,#p-category,#p-unit,#p-county')).map(el => ({
          id: el.id,
          value: 'value' in el ? el.value : (el.textContent || '').trim(),
          invalid: el.getAttribute('aria-invalid'),
          required: 'required' in el ? el.required : false,
        })),
        visibleErrors: Array.from(document.querySelectorAll('p,span,div')).filter(el => {
          const text = (el.textContent || '').trim();
          return text.length > 0 && text.length < 180 && /choose a category|choose the unit|price must|quantity must|phone number|at least 4 characters|at least 20 characters|choose your district|negotiable/i.test(text);
        }).map(el => (el.textContent || '').trim()).slice(-30),
        bodyText: document.body.innerText.slice(-3500),
      }));
      diagnostics.publishClickError = publishClickError ? publishClickError.message : null;
      diagnostics.browserConsoleErrors = browserConsoleErrors;
      diagnostics.browserPageErrors = browserPageErrors;
      console.error('Listing publish browser diagnostic:', JSON.stringify(diagnostics, null, 2));
      throw new Error('No POST /api/listings response was observed: ' + createResult.error.message);
    }
    createResponse = createResult.response;
    if (publishClickError) throw publishClickError;
    const createBody = await createResponse.text();
    if (createResponse.status() !== 201) {
      throw new Error('Listing creation failed: HTTP ' + createResponse.status() + ' ' + createBody.slice(0, 500));
    }
    await page.waitForFunction(() => window.location.hash.startsWith('#/listing/'), null, { timeout });
    await page.getByText(title, { exact: true }).waitFor({ state: 'visible', timeout });

    const gallery = page.locator('[aria-roledescription="carousel"]');
    await gallery.waitFor({ state: 'visible', timeout });
    await page.getByRole('button', { name: 'Next product photo' }).click();
    await page.getByText('2 / 2', { exact: true }).waitFor({ state: 'visible', timeout });
    await page.getByRole('button', { name: 'Previous product photo' }).click();
    await page.getByText('1 / 2', { exact: true }).waitFor({ state: 'visible', timeout });

    // Recheck the gallery controls at a phone width, and ensure the page itself
    // does not gain horizontal overflow while the image is shown.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobileGallery = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    if (mobileGallery.pageWidth > mobileGallery.viewportWidth + 1) {
      throw new Error('Listing photo gallery introduced mobile horizontal overflow: ' + JSON.stringify(mobileGallery));
    }
    await page.getByRole('button', { name: 'Next product photo' }).click();
    await page.getByText('2 / 2', { exact: true }).waitFor({ state: 'visible', timeout });

    // The public share page must use the same uncropped, arrow-based gallery.
    const listingHash = new URL(page.url()).hash;
    const publicListingId = listingHash.match(/^#\/listing\/([^/?#]+)/)?.[1];
    if (!publicListingId) throw new Error('Could not read the published listing id from the app URL: ' + listingHash);
    await page.goto(base + '/l/' + encodeURIComponent(publicListingId), { waitUntil: 'domcontentloaded', timeout: 60000 });
    const publicGallery = page.locator('[aria-roledescription="carousel"]');
    await publicGallery.waitFor({ state: 'visible', timeout });
    await page.getByRole('button', { name: 'Next product photo' }).click();
    await page.getByText('2 / 2', { exact: true }).waitFor({ state: 'visible', timeout });
    const publicPhotoFit = await publicGallery.locator('img').first().evaluate((img) => getComputedStyle(img).objectFit);
    if (publicPhotoFit !== 'contain') throw new Error('Public product gallery must show the whole photo; object-fit was ' + publicPhotoFit);
    await page.getByRole('button', { name: 'Previous product photo' }).click();
    await page.getByText('1 / 2', { exact: true }).waitFor({ state: 'visible', timeout });

    // Verify the real buyer contact action reveals the number only on demand,
    // then exposes working telephone and WhatsApp destinations.
    const contactResponsePromise = page.waitForResponse((response) => {
      return new URL(response.url()).pathname === '/api/listings/' + encodeURIComponent(publicListingId) + '/contact';
    }, { timeout });
    await page.getByRole('button', { name: 'Show number', exact: true }).click();
    const contactResponse = await contactResponsePromise;
    if (!contactResponse.ok()) throw new Error('Public contact reveal failed: HTTP ' + contactResponse.status());
    const callLink = page.getByRole('link', { name: /^Call / });
    await callLink.waitFor({ state: 'visible', timeout });
    const callHref = await callLink.getAttribute('href');
    if (!callHref?.startsWith('tel:')) throw new Error('Public Call action did not produce a tel: link');
    const whatsappLink = page.getByRole('link', { name: 'WhatsApp', exact: true });
    await whatsappLink.waitFor({ state: 'visible', timeout });
    const whatsappHref = await whatsappLink.getAttribute('href');
    if (!whatsappHref?.startsWith('https://wa.me/')) throw new Error('Public WhatsApp action did not produce a wa.me link');

    // The shop link must lead to the actual shop route, not a dead button.
    // Use the stable destination contract rather than localized accessible copy.
    const shopLink = page.locator('a[href^="/#/shop/"]');
    const shopHref = await shopLink.getAttribute('href');
    if (!shopHref || !/^\/#\/shop\/[^/]+$/.test(shopHref)) throw new Error('Public shop link is malformed: ' + shopHref);
    await shopLink.click();
    await page.waitForFunction(() => window.location.hash.startsWith('#/shop/'), null, { timeout });
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('button', { name: 'Show number', exact: true }).waitFor({ state: 'visible', timeout });

    // At desktop widths the featured-shop rail provides a scannable QR code
    // for the same named shop. Verify the SVG is present and labelled accessibly.
    await page.goto(base + '/#/browse', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const featuredShop = page.locator('aside[aria-label="Featured shop from your results"]');
    await featuredShop.waitFor({ state: 'visible', timeout });
    const shopQr = featuredShop.getByRole('img', { name: "QR code for Browser Lifecycle Shop's shop" });
    await shopQr.waitFor({ state: 'visible', timeout });
    const qrShape = await shopQr.evaluate((svg) => ({
      viewBox: svg.getAttribute('viewBox'),
      hasPath: Boolean(svg.querySelector('path')),
    }));
    if (!qrShape.viewBox || !qrShape.hasPath) {
      throw new Error('Featured shop QR did not render a scannable SVG: ' + JSON.stringify(qrShape));
    }

    await page.goto(base + '/#/my-listings', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: /my listings/i }).waitFor({ state: 'visible', timeout });
    const listingCard = () => page.locator('div.overflow-hidden.rounded-lg.border.bg-card').filter({ hasText: editedTitle });
    const originalCard = page.locator('div.overflow-hidden.rounded-lg.border.bg-card').filter({ hasText: title });
    await originalCard.waitFor({ state: 'visible', timeout });
    await originalCard.getByRole('button', { name: /edit/i }).click();
    await page.waitForFunction(() => window.location.hash.startsWith('#/edit/'), null, { timeout });
    await page.locator('#e-title').waitFor({ state: 'visible', timeout });
    await page.locator('#e-title').fill(editedTitle);
    await page.locator('#e-desc').fill('Updated regression fixture proving the edit journey persists.');
    const editResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'PATCH'
        && new URL(response.url()).pathname.startsWith('/api/listings/');
    }, { timeout });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    const editResponse = await editResponsePromise;
    const editBody = await editResponse.text();
    if (!editResponse.ok()) {
      throw new Error('Listing edit failed: HTTP ' + editResponse.status() + ' ' + editBody.slice(0, 500));
    }
    await page.waitForFunction(() => window.location.hash.startsWith('#/listing/'), null, { timeout });
    await page.getByText(editedTitle, { exact: true }).waitFor({ state: 'visible', timeout });

    await page.goto(base + '/#/my-listings', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('heading', { name: /my listings/i }).waitFor({ state: 'visible', timeout });
    const card = listingCard();
    await card.waitFor({ state: 'visible', timeout });
    await card.getByRole('button', { name: /delete/i }).click();
    const confirmation = page.getByRole('alertdialog');
    await confirmation.waitFor({ state: 'visible', timeout });
    const deleteResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'DELETE'
        && new URL(response.url()).pathname.startsWith('/api/listings/');
    }, { timeout });
    await confirmation.getByRole('button', { name: /delete/i }).click();
    const deleteResponse = await deleteResponsePromise;
    const deleteBody = await deleteResponse.text();
    if (!deleteResponse.ok()) {
      throw new Error('Listing deletion failed: HTTP ' + deleteResponse.status() + ' ' + deleteBody.slice(0, 500));
    }
    await card.waitFor({ state: 'detached', timeout });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByText(editedTitle, { exact: true }).waitFor({ state: 'detached', timeout });

    console.log(JSON.stringify({
      listingLifecycle: 'pass',
      create: 'listing published and opened',
      edit: 'updated title persisted',
      delete: 'listing absent after reload',
    }, null, 2));
  } finally {
    await context.close();
  }
}

async function verifyOpeningHoursSchedule(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const phone = uniquePhone();
  const expectedHours = 'Mon, Wed, 8:30 am - 6:00 pm';

  try {
    const registration = await context.request.post(base + '/api/auth/register', {
      data: {
        phone,
        name: 'Browser Opening Hours Tester',
        password: 'password321',
        country: 'UG',
        acceptTerms: true,
      },
      headers: { origin: base, referer: base + '/' },
      timeout,
    });
    if (registration.status() !== 201) {
      throw new Error('Could not create disposable opening-hours account: HTTP ' + registration.status());
    }

    const profileResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/profile' && response.request().method() === 'GET';
    }, { timeout });
    await page.goto(base + '/#/account', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const profileResponse = await profileResponsePromise;
    if (!profileResponse.ok()) throw new Error('Opening-hours profile request failed: HTTP ' + profileResponse.status());

    const shopSetupDialog = page.getByRole('dialog').filter({ hasText: /Welcome to Mudaala/i });
    if (await shopSetupDialog.isVisible().catch(() => false)) {
      await shopSetupDialog.getByRole('button', { name: 'Later', exact: true }).click();
      await shopSetupDialog.waitFor({ state: 'hidden', timeout });
    }

    const builder = page.getByRole('group', { name: 'Weekly opening schedule' });
    await builder.waitFor({ state: 'visible', timeout });
    await builder.getByRole('button', { name: 'Daily', exact: true }).click();
    await page.locator('#bp-open-time').fill('08:30');
    await page.locator('#bp-close-time').fill('18:00');
    await builder.getByRole('button', { name: 'Use this schedule' }).click();
    await page.waitForFunction(() => document.querySelector('#bp-hours')?.value === 'Daily, 8:30 am - 6:00 pm', null, { timeout });

    // Verify individual days remain selectable on a narrow phone viewport.
    await builder.getByRole('button', { name: 'Clear days', exact: true }).click();
    await builder.getByRole('checkbox', { name: 'Monday' }).check();
    await builder.getByRole('checkbox', { name: 'Wednesday' }).check();
    await builder.getByRole('button', { name: 'Use this schedule' }).click();
    await page.waitForFunction((value) => document.querySelector('#bp-hours')?.value === value, expectedHours, { timeout });

    const mobileSize = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    if (mobileSize.page > mobileSize.viewport + 1) {
      throw new Error('Opening-hours schedule introduced mobile horizontal overflow: ' + JSON.stringify(mobileSize));
    }

    const saveResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/profile' && response.request().method() === 'PUT';
    }, { timeout });
    await page.getByRole('button', { name: 'Save shop', exact: true }).click();
    const saveResponse = await saveResponsePromise;
    if (!saveResponse.ok()) throw new Error('Saving opening-hours schedule failed: HTTP ' + saveResponse.status());

    const reloadProfilePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/profile' && response.request().method() === 'GET';
    }, { timeout });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    const reloadProfile = await reloadProfilePromise;
    if (!reloadProfile.ok()) throw new Error('Reloading opening-hours profile failed: HTTP ' + reloadProfile.status());
    await page.waitForFunction((value) => document.querySelector('#bp-hours')?.value === value, expectedHours, { timeout });
    await page.waitForFunction(() => {
      const monday = document.querySelector('input[aria-label="Monday"]')
      const wednesday = document.querySelector('input[aria-label="Wednesday"]')
      return monday instanceof HTMLInputElement && monday.checked &&
        wednesday instanceof HTMLInputElement && wednesday.checked
    }, null, { timeout });

    console.log(JSON.stringify({
      openingHours: 'pass (Daily preset and individual days)',
      persistence: 'pass (saved and restored after a fresh page load)',
      mobile: 'pass (390px viewport, no horizontal overflow)',
    }, null, 2));
  } finally {
    await context.close();
  }
}

async function verifyMobileCart(browser) {
  // Exercise the real mobile layout at a narrow CSS viewport with touch input.
  // Chromium's isMobile device emulation in CI produced a mismatched layout
  // viewport for fixed controls, despite a correctly sized visual viewport.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
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
    try {
      await cartBar.click({ timeout });
    } catch (error) {
      const diagnostic = await page.evaluate(() => {
        const el = document.querySelector('button[aria-controls="cart-mobile-sheet"]');
        if (!(el instanceof HTMLElement)) return { found: false };
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const describe = (node) => {
          if (!(node instanceof HTMLElement)) return null;
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return {
            tag: node.tagName,
            text: (node.innerText || '').trim().slice(0, 100),
            className: typeof node.className === 'string' ? node.className.slice(0, 220) : '',
            position: style.position,
            zIndex: style.zIndex,
            transform: style.transform,
            opacity: style.opacity,
            pointerEvents: style.pointerEvents,
            rect: { x: box.x, y: box.y, width: box.width, height: box.height },
          };
        };
        const ancestors = (node) => {
          const result = [];
          let current = node;
          while (current instanceof HTMLElement && result.length < 8) {
            result.push(describe(current));
            current = current.parentElement;
          }
          return result;
        };
        const metaViewport = document.querySelector('meta[name="viewport"]');
        return {
          viewport: { width: innerWidth, height: innerHeight },
          visualViewport: window.visualViewport ? {
            width: window.visualViewport.width,
            height: window.visualViewport.height,
            scale: window.visualViewport.scale,
          } : null,
          screen: { width: screen.width, height: screen.height, devicePixelRatio },
          viewportMeta: metaViewport?.getAttribute('content') ?? null,
          viewportMetas: Array.from(document.querySelectorAll('meta[name="viewport"]')).map(m => m.getAttribute('content')),
          rootZoom: getComputedStyle(document.documentElement).zoom,
          bodyZoom: getComputedStyle(document.body).zoom,
          outerSize: { width: outerWidth, height: outerHeight },
          rootBox: describe(document.documentElement),
          bodyBox: describe(document.body),
          documentSizes: {
            rootClient: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
            rootScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
            bodyScrollWidth: document.body.scrollWidth,
          },
          button: describe(el),
          buttonAncestors: ancestors(el),
          hitTarget: describe(hit),
          hitAncestors: ancestors(hit),
        };
      });
      console.error('Mobile cart click diagnostic:', JSON.stringify(diagnostic, null, 2));
      throw error;
    }
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
  const { chromium } = await import('/tmp/mudaala-browser-test/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({ headless: true });
  try {
    await verifySavedSearch(browser);
    await verifyListingLifecycle(browser);
    await verifyOpeningHoursSchedule(browser);
    await verifyMobileCart(browser);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
