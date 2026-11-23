import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ReportStore } from '../../dev-memory/report-store.mjs';

export function sha256File(filePath) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

export function writeJson(filePath, value) {
  new ReportStore().writeAtomic(filePath, value);
}

/**
 * Collect a page's L2-L6 evidence in the browser. The function is self-contained
 * because Playwright serializes it into the page context.
 */
export function collectBrowserProbes({ pageClass, states }) {
  const rounded = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return { x: rounded(box.x), y: rounded(box.y), width: rounded(box.width), height: rounded(box.height) };
  };
  const style = (element) => {
    const computed = getComputedStyle(element);
    const keys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderRadius', 'boxShadow', 'display', 'position'];
    return Object.fromEntries(keys.map((key) => [key, computed[key]]));
  };
  const selectors = ['#Top', '#Wrapper', '#Main', '#Rightbar', '.box', '.cell', '.pager', 'form'];
  const geometry = selectors.flatMap((selector) =>
    [...document.querySelectorAll(selector)].slice(0, 30).map((element) => ({
      selector,
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === 'string' ? element.className : null,
      rect: rect(element),
    })));
  const overflow = {
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
  const main = document.querySelector('#Main');
  const rightbar = document.querySelector('#Rightbar');
  const mainRect = main ? rect(main) : null;
  const rightRect = rightbar ? rect(rightbar) : null;
  const overlap = Boolean(mainRect && rightRect && mainRect.x + mainRect.width > rightRect.x + 1);

  const styleSelectors = ['body', '#Top', '#Main', '.box', '.cell', 'a', 'button', 'input'];
  const styles = styleSelectors.flatMap((selector) =>
    [...document.querySelectorAll(selector)].slice(0, 12).map((element) => ({
      selector,
      tag: element.tagName.toLowerCase(),
      style: style(element),
    })));

  const landmarks = [...document.querySelectorAll('header,nav,main,footer,h1,h2')].map((element) => ({
    tag: element.tagName.toLowerCase(),
    text: (element.textContent ?? '').trim().slice(0, 120),
    rect: rect(element),
  }));
  const unlabeledControls = [...document.querySelectorAll('input,select,textarea')]
    .filter((element) => !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby'))
    .map((element) => element.outerHTML.slice(0, 240));
  const emptyTargets = [...document.querySelectorAll('a,button')]
    .filter((element) => !(element.textContent ?? '').trim() && !element.getAttribute('aria-label'))
    .map((element) => element.outerHTML.slice(0, 240));
  const domAria = {
    title: document.title,
    lang: document.documentElement.lang,
    landmarks,
    headings: [...document.querySelectorAll('h1,h2,h3,h4')].map((element) => ({ level: Number(element.tagName[1]), text: (element.textContent ?? '').trim().slice(0, 120) })),
    unlabeledControls,
    emptyTargets,
    childOrder: [...(main?.children ?? [])].map((element) => element.tagName.toLowerCase()),
  };

  const luminance = (rgb) => {
    const channels = rgb.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const contrastChecks = [...document.querySelectorAll('a,button,.cell,.box')].slice(0, 40).map((element) => {
    const computed = getComputedStyle(element);
    let background = computed.backgroundColor;
    let parent = element.parentElement;
    while ((background === 'rgba(0, 0, 0, 0)' || background === 'transparent') && parent) {
      background = getComputedStyle(parent).backgroundColor;
      parent = parent.parentElement;
    }
    const foregroundLum = luminance(computed.color);
    const backgroundLum = luminance(background);
    const ratio = (Math.max(foregroundLum, backgroundLum) + 0.05) / (Math.min(foregroundLum, backgroundLum) + 0.05);
    return { tag: element.tagName.toLowerCase(), text: (element.textContent ?? '').trim().slice(0, 60), color: computed.color, background, ratio: rounded(ratio) };
  });
  const interaction = {
    availableStates: ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'error', 'empty'],
    observed: {
      disabled: document.querySelectorAll('[disabled]').length,
      loading: document.querySelectorAll('[aria-busy="true"],.loading').length,
      error: document.querySelectorAll('[role="alert"],.error,.field-error').length,
      empty: document.querySelectorAll('.empty-state,[data-empty="true"]').length,
    },
    contrastChecks,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    touchPoints: navigator.maxTouchPoints,
    states,
    pageClass,
  };
  const responsive = {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    overflow,
    dataStates: states,
    missingImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.currentSrc || image.src),
    theme: document.documentElement.dataset.effectiveTheme ?? document.documentElement.dataset.theme ?? null,
    horizontalOverflow: overflow.horizontalOverflow,
  };
  return { geometry: { boxes: geometry, overlap, overflow }, styles, domAria, interaction, responsive };
}

/**
 * Collect only high-level numeric/behavioral observations from a public official
 * page. No HTML, CSS source, screenshot, font, icon or other asset is persisted.
 */
export async function collectOfficialObservations(page, url) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`));
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  const observation = await page.evaluate(() => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const style = (element) => {
      if (!element) return null;
      const computed = getComputedStyle(element);
      return {
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
      };
    };
    const main = document.querySelector('#Main, main, .main, #Wrapper');
    const rightbar = document.querySelector('#Rightbar, .rightbar, aside');
    return {
      title: document.title,
      lang: document.documentElement.lang,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      document: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      boxes: {
        top: box(document.querySelector('#Top, header, .top')),
        wrapper: box(document.querySelector('#Wrapper, .wrapper')),
        main: box(main),
        rightbar: box(rightbar),
        firstTopic: box(document.querySelector('.cell.item, .topic, .item')),
      },
      styles: {
        body: style(document.body),
        main: style(main),
        firstTopic: style(document.querySelector('.cell.item, .topic, .item')),
      },
    };
  });
  return {
    url,
    final_url: page.url(),
    http_status: response?.status() ?? null,
    status: response?.ok() ? 'observed' : `http-${response?.status() ?? 'unknown'}`,
    captured_at: new Date().toISOString(),
    legal_basis: 'Public page live observation; numeric geometry and computed style only; no source or assets copied.',
    eligible_for_official_pixel_claim: false,
    page_errors: errors,
    observation,
  };
}

/**
 * Collect evidence for one page/viewport.
 *
 * @param {import('playwright').Page} page
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function collectPageEvidence(page, options) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http:${response.status()} ${response.url()}`);
  });
  const response = await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(150);
  const firstLayout = await page.evaluate(() => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`);
  await page.waitForTimeout(150);
  const secondLayout = await page.evaluate(() => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`);
  const probes = await page.evaluate(collectBrowserProbes, { pageClass: options.pageClass, states: options.states });

  const firstFocus = page.locator('a,button,input,select,textarea,[tabindex]').first();
  if (await firstFocus.count()) {
    await firstFocus.focus();
    probes.interaction.focus = await firstFocus.evaluate((element) => ({
      tag: element.tagName.toLowerCase(),
      outline: getComputedStyle(element).outline,
      active: document.activeElement === element,
    }));
    await page.keyboard.press('Tab');
    probes.interaction.keyboardTab = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase() ?? null,
      text: (document.activeElement?.textContent ?? '').trim().slice(0, 80),
    }));
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  probes.interaction.reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  probes.responsive.zoom200 = await page.evaluate(() => ({
    method: 'CDP Emulation.setPageScaleFactor',
    pageScaleFactor: 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await cdp.detach();

  const screenshotPath = options.screenshotPath;
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
  return {
    status: response?.ok() ? 'ok' : `http-${response?.status() ?? 'unknown'}`,
    finalUrl: page.url(),
    httpStatus: response?.status() ?? null,
    layoutStable: firstLayout === secondLayout,
    consoleErrors: errors,
    ...probes,
  };
}
