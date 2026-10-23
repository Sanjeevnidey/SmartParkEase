// Browser smoke test: register, book a spot, check the spot map and the admin dashboard.
// Needs the API and the Vite dev server running, and Playwright installed (npm i -D playwright).
// Usage: APP_URL=http://localhost:5173 ADMIN_EMAIL=... ADMIN_PASSWORD=... node e2e/smoke.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.env.APP_URL || 'http://localhost:5173';
const out = process.env.SCREENSHOT_DIR || 'e2e/screenshots';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const log = (...a) => console.log(...a);
  await page.goto(base + '/');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/01-overview-guest.png`, fullPage: false });
  // register
  await page.goto(base + '/login');
  await page.getByText('New to ParkEase? Create an account').click();
  await page.getByLabel('Your name').fill('Priya Student');
  await page.getByLabel('Email address').fill(`priya${Date.now()}@test.local`);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.waitForTimeout(1200);
  log('after register url', page.url());
  await page.goto(base + '/explore');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/02-explore.png` });
  await page.locator('.book-circle').first().click();
  await page.waitForTimeout(1500);
  const slots = await page.locator('.parking-slot').count();
  log('slot buttons', slots);
  await page.locator('select').nth(0).selectOption('17:00').catch(e => log('select start fail', e.message));
  await page.waitForTimeout(1200);
  await page.getByLabel('License plate').fill('KA 01 AB ' + String(Date.now()).slice(-4));
  await page.screenshot({ path: `${out}/03-booking-form.png`, fullPage: true });
  await page.getByRole('button', { name: /Confirm booking/ }).click();
  await page.waitForTimeout(1500);
  log('ticket', await page.locator('.ticket').innerText().catch(() => 'none'));
  await page.screenshot({ path: `${out}/04-booking-confirmed.png` });
  await page.goto(base + '/bookings');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/05-my-bookings.png` });
  // same spot again by same user different plate should now show as booked
  await page.goto(base + '/explore');
  await page.locator('.book-circle').first().click();
  await page.waitForTimeout(800);
  await page.locator('select').nth(0).selectOption('17:00');
  await page.waitForTimeout(1200);
  log('booked spots shown', await page.locator('.parking-slot.occupied').count());
  // sign out, sign in as admin
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(base + '/login');
  await page.getByLabel('Email address').fill(process.env.ADMIN_EMAIL);
  await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await page.waitForTimeout(1200);
  await page.goto(base + '/admin');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/06-admin.png`, fullPage: true });
  log('admin model panel', await page.locator('.model-panel').innerText().catch(() => 'none'));
  // mobile
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(base + '/explore'); await m.waitForTimeout(1000);
  await m.screenshot({ path: `${out}/07-mobile-explore.png` });
  log('errors', JSON.stringify(errors, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
