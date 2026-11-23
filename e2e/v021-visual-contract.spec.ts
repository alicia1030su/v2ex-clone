import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: '375x812', width: 375, height: 812, isMobile: true, hasTouch: true },
  { name: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: '768x1024', width: 768, height: 1024, isMobile: false, hasTouch: false },
  { name: '1280x900', width: 1280, height: 900, isMobile: false, hasTouch: false },
  { name: '1920x1080', width: 1920, height: 1080, isMobile: false, hasTouch: false },
];

const ROUTES = [
  '/',
  '/recent',
  '/hot',
  '/following',
  '/nodes',
  '/go/claude',
  '/t/1',
  '/member/admin',
  '/signin',
  '/signup',
  '/forgot',
  '/go/search?q=claude',
  '/tag/visual-audit',
  '/leaderboard',
  '/about',
  '/faq',
  '/privacy',
  '/worldclock',
  '/xna',
];

for (const viewport of VIEWPORTS) {
  test.describe(`v021 visual contract ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      locale: 'zh-CN',
      colorScheme: 'light',
    });

    for (const route of ROUTES) {
      test(`${route} has no overflow or runtime noise`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(`console:${message.text()}`);
        });
        const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), route).toBeLessThan(400);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        expect(overflow, `${route} horizontal overflow`).toBe(false);
        expect(errors, `${route} runtime errors`).toEqual([]);

        const firstControl = page.locator('a,button,input,select,textarea,[tabindex]').first();
        if (await firstControl.count()) {
          await firstControl.focus();
          await expect(firstControl).toBeFocused();
          await page.keyboard.press('Tab');
        }
      });
    }
  });
}
