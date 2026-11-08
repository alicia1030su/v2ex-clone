/**
 * 页面健康门禁（Page Health Gate）
 *
 * ## 为什么需要这个模块（真实事故背景）
 *
 * 2026-11-08 人工检查发现 README 首页截图 `docs/evidence/screenshots/desktop-1280/local-home.png`
 * **完全没有应用 CSS**：默认蓝色下划线链接、内容堆在左上角、双栏消失、白卡消失。
 * 而同一时期视觉回归报告是「63/63 全绿」。
 *
 * 根因不是 CSS 写错了，而是**截图工具把质量判据搞反了**：
 *   - `tools/visual/capture.mjs` 给整个浏览器进程加了 `--proxy-server`，
 *     localhost 的 `/_next/static/*` 请求被送进代理 ⇒ CSS/JS 全部取不到；
 *   - `capture()` 里 `waitForLoadState('networkidle').catch(() => {})` 把失败吞掉，
 *     继续截图并打印成功；
 *   - 回归工具比的是「本站自己和自己」，基线本身也是无 CSS 的页面 ⇒ 无 CSS 反而稳定通过。
 *
 * ⇒ 只比较像素或只比较基线都抓不到这类事故。**必须先证明这张截图是一张有效的截图。**
 *
 * ## 判据分层
 *
 * 1. **加载层**：导航成功、最终 URL 正确、CSS/JS/static 请求无失败
 * 2. **应用层**：`document.styleSheets` 真的解析出规则、无致命脚本错误
 * 3. **设计层**：关键元素的计算样式符合设计约束（灰底、白卡、双栏、字体）
 * 4. **稳定性**：连续两次采样布局一致、字体已就绪、横向溢出为零
 *
 * 任何一层不通过 ⇒ 该截图为**无效**，调用方必须失败，而不是保存后标记成功。
 *
 * ## 反模式（禁止）
 *
 * - 禁止 `.catch(() => {})` 静默吞掉导航/等待失败
 * - 禁止把「没检测到问题」当成「没有问题」：CSS 数量为 0 必须显式判红
 * - 禁止白名单化 console 错误来让流程变绿（默认白名单为空）
 */

/** 设计约束（数值来自 src/app/globals.css 的实测值，改动需同步） */
export const DESIGN = {
  /** #Wrapper 灰色页面背景 */
  wrapperBg: 'rgb(226, 226, 226)',
  /** .box 白色卡片 */
  boxBg: 'rgb(255, 255, 255)',
  /** .box 圆角 */
  boxRadius: '3px',
  /** #Rightbar 固定宽度 */
  rightbarWidth: 270,
  /** .content 居中最大宽度（#Wrapper 内） */
  contentMaxWidth: 1100,
  /** body 字号 */
  bodyFontSize: '14px',
  /** body 字体族必须包含的首选字体 */
  bodyFontFamily: 'Helvetica Neue',
  /** 浏览器默认链接色 —— 出现即意味着 CSS 未生效 */
  uaLinkColor: 'rgb(0, 0, 238)',
  /** 站点链接色 #778087 */
  siteLinkColor: 'rgb(119, 128, 135)',
};

/** 与页面内容无关、可安全忽略的网络噪音（仅限非静态资源） */
const IGNORABLE_URL_PATTERNS = [
  /\/favicon\.ico(\?|$)/,
  /\/apple-touch-icon\.png(\?|$)/,
];

/**
 * 预期内的中断请求。
 *
 * Next.js App Router 会对视口内的 `<Link>` 预取 RSC payload（`?_rsc=`）。
 * 页面关闭或导航时这些预取被主动中断，Chromium 报 `net::ERR_ABORTED`。
 * **这是框架的正常行为，不是资源加载失败**。
 * 只放行「`_rsc=` 且 ERR_ABORTED」这一个精确组合，别的中断照旧判红。
 */
function isExpectedAbort(url, error) {
  return url.includes('_rsc=') && /ERR_ABORTED/.test(error);
}

/** console 错误白名单：默认为空。新增条目必须写明原因与到期版本。 */
const CONSOLE_ERROR_ALLOWLIST = [];

function isIgnorable(url) {
  return IGNORABLE_URL_PATTERNS.some((re) => re.test(url));
}

/**
 * 在导航**之前**挂载探针。
 *
 * @param {import('playwright').Page} page
 * @returns {object} 探针状态
 */
export function attachProbe(page) {
  const state = {
    responses: [],
    requestFailures: [],
    consoleErrors: [],
    pageErrors: [],
    crashed: false,
    navigations: [],
  };

  page.on('response', (res) => {
    const req = res.request();
    state.responses.push({
      url: res.url(),
      status: res.status(),
      resourceType: req.resourceType(),
    });
  });

  page.on('requestfailed', (req) => {
    state.requestFailures.push({
      url: req.url(),
      resourceType: req.resourceType(),
      error: req.failure()?.errorText ?? 'unknown',
    });
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ERROR_ALLOWLIST.some((re) => re.test(text))) return;
    state.consoleErrors.push({ text, location: msg.location() });
  });

  page.on('pageerror', (err) => {
    state.pageErrors.push({ message: err.message, stack: err.stack ?? null });
  });

  page.on('crash', () => {
    state.crashed = true;
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) state.navigations.push(frame.url());
  });

  return state;
}

/**
 * 等待页面真正「画完」：网络静默 + 字体就绪 + 布局连续两次采样一致。
 *
 * 与旧实现的区别：**每一步都返回是否成功**，由调用方决定失败还是继续。
 * 旧实现用 `.catch(() => {})` 一律吞掉，等于放弃判定。
 *
 * @returns {Promise<{networkIdle:boolean, fontsReady:boolean, layoutStable:boolean, samples:number}>}
 */
export async function waitForStable(page, { timeout = 30000, settleMs = 250 } = {}) {
  let networkIdle = false;
  try {
    await page.waitForLoadState('networkidle', { timeout });
    networkIdle = true;
  } catch {
    networkIdle = false;
  }

  let fontsReady = false;
  try {
    fontsReady = await page.evaluate(async () => {
      if (!document.fonts) return true;
      await document.fonts.ready;
      return document.fonts.status === 'loaded';
    });
  } catch {
    fontsReady = false;
  }

  // 布局稳定：连续两次采样同一组几何值，直至相等
  const snapshot = () =>
    page.evaluate(() => {
      const pick = ['#Top', '#Wrapper', '#Main', '#Rightbar', '.box'];
      const out = {};
      for (const sel of pick) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        out[sel] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
      }
      out.__scroll = [document.documentElement.scrollWidth, window.innerWidth];
      return out;
    });

  let layoutStable = false;
  let samples = 0;
  let prev = null;
  for (let i = 0; i < 12; i += 1) {
    const cur = await snapshot();
    samples += 1;
    if (prev && JSON.stringify(prev) === JSON.stringify(cur)) {
      layoutStable = true;
      break;
    }
    prev = cur;
    await page.waitForTimeout(settleMs);
  }

  return { networkIdle, fontsReady, layoutStable, samples };
}

/**
 * 采集判定所需的全部证据（在浏览器里执行）。
 */
async function collectEvidence(page) {
  return page.evaluate((design) => {
    const px = (v) => {
      const n = Number.parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };

    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        visible: r.width > 0 && r.height > 0,
      };
    };

    const styleOf = (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      const out = {};
      for (const p of props) out[p] = cs.getPropertyValue(p);
      return out;
    };

    // ---- 样式表加载情况 ----
    const styleSheets = Array.from(document.styleSheets).map((ss) => {
      let rules = null;
      let error = null;
      try {
        rules = ss.cssRules ? ss.cssRules.length : null;
      } catch (e) {
        error = String(e && e.message ? e.message : e);
      }
      return {
        href: ss.href,
        ownerTag: ss.ownerNode ? ss.ownerNode.tagName : null,
        media: ss.media ? ss.media.mediaText : null,
        disabled: ss.disabled ?? null,
        ruleCount: rules,
        error,
      };
    });

    const linkSheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => ({
      href: l.href,
      hasSheet: Boolean(l.sheet),
      media: l.media || null,
    }));

    // ---- 未应用 CSS 的识别特征 ----
    const links = Array.from(document.querySelectorAll('a'));
    const uaLinks = links.filter((a) => {
      const cs = window.getComputedStyle(a);
      return cs.color === design.uaLinkColor;
    });
    // 默认 UA 样式下 <a> 带下划线；站点样式的链接默认无下划线
    const underlinedLinks = links.filter((a) => {
      const cs = window.getComputedStyle(a);
      return (
        cs.textDecorationLine.includes('underline') && cs.color === design.uaLinkColor
      );
    });

    // ---- 字体 ----
    const bodyFont = window.getComputedStyle(document.body).fontFamily || '';

    // ---- 关键元素 ----
    const wrappers = {
      top: rectOf('#Top'),
      wrapper: rectOf('#Wrapper'),
      content: rectOf('#Wrapper > .content'),
      main: rectOf('#Main'),
      rightbar: rectOf('#Rightbar'),
      firstBox: rectOf('.box'),
    };

    const styles = {
      wrapper: styleOf('#Wrapper', ['background-color', 'background-image']),
      main: styleOf('#Main', ['margin-left', 'margin-right', 'width', 'float']),
      rightbar: styleOf('#Rightbar', ['width', 'float', 'margin-right']),
      box: styleOf('.box', ['background-color', 'box-shadow', 'border-radius', 'border-bottom-width']),
      body: styleOf('body', ['font-family', 'font-size', 'background-color', 'color']),
      top: styleOf('#Top', ['background-color', 'min-height', 'border-bottom-width']),
    };

    // ---- 主题行（首页/节点页） ----
    const topicLinks = Array.from(document.querySelectorAll('.topic-link, .item_title a'));
    const firstTopic = topicLinks[0]
      ? (() => {
          const cs = window.getComputedStyle(topicLinks[0]);
          return {
            text: (topicLinks[0].textContent || '').trim().slice(0, 60),
            color: cs.color,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            textDecoration: cs.textDecorationLine,
          };
        })()
      : null;

    // ---- 头像/Logo 实例加载情况 ----
    const images = Array.from(document.querySelectorAll('img')).map((img) => ({
      src: img.currentSrc || img.src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete,
      cls: img.className || null,
      alt: img.alt || null,
    }));
    const brokenImages = images.filter((i) => i.complete && i.naturalWidth === 0);

    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      styleSheets,
      linkSheets,
      counts: {
        links: links.length,
        uaLinks: uaLinks.length,
        underlinedLinks: underlinedLinks.length,
        styleSheets: styleSheets.length,
        images: images.length,
        topicLinks: topicLinks.length,
      },
      uaLinkSample: uaLinks.slice(0, 3).map((a) => ({
        text: (a.textContent || '').trim().slice(0, 40),
        href: a.getAttribute('href'),
      })),
      bodyFont,
      wrappers,
      styles,
      firstTopic,
      brokenImages,
      images: images.slice(0, 8),
      horizontalOverflow:
        document.documentElement.scrollWidth - window.innerWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
    };
  }, DESIGN);
}

/**
 * 把证据转成门禁结论。
 *
 * @param {object} evidence collectEvidence 的返回
 * @param {object} state    探针状态
 * @param {object} opts     { expectUrl, requireRightbar, profile }
 * @returns {{ok:boolean, checks:Array<{id,label,ok,detail,severity}>}}
 */
export function evaluateGates(evidence, state, opts = {}) {
  const { expectUrl = null, requireRightbar = false } = opts;
  const checks = [];
  const add = (id, label, ok, detail, severity = 'blocker') => {
    checks.push({ id, label, ok: Boolean(ok), detail, severity });
  };

  // ---------- 1. 加载层 ----------
  const mainResponses = state.responses.filter(
    (r) => r.resourceType === 'document' && r.url.startsWith(evidence.url.split('?')[0].split('#')[0]),
  );
  const docStatus = mainResponses.length ? mainResponses[mainResponses.length - 1].status : null;
  add(
    'document.status',
    'HTML 页面响应 2xx/3xx',
    docStatus !== null && docStatus < 400,
    docStatus === null ? '未捕获到文档响应' : `HTTP ${docStatus}`,
  );

  if (expectUrl) {
    const actualPath = (() => {
      try {
        return new URL(evidence.url).pathname;
      } catch {
        return evidence.url;
      }
    })();
    add(
      'navigation.url',
      '最终 URL 与预期路由一致',
      actualPath === expectUrl,
      `期望 ${expectUrl}，实际 ${actualPath}（完整 ${evidence.url}）`,
    );
  }

  const cssResponses = state.responses.filter((r) => r.resourceType === 'stylesheet');
  const cssOk = cssResponses.filter((r) => r.status < 400);
  add(
    'css.requests',
    '样式表请求全部成功',
    cssResponses.length > 0 && cssOk.length === cssResponses.length,
    `共 ${cssResponses.length} 个，成功 ${cssOk.length} 个` +
      (cssResponses.length - cssOk.length > 0
        ? `，失败：${cssResponses
            .filter((r) => r.status >= 400)
            .map((r) => `${r.status} ${r.url}`)
            .slice(0, 3)
            .join(' | ')}`
        : ''),
  );

  const scriptResponses = state.responses.filter((r) => r.resourceType === 'script');
  const scriptOk = scriptResponses.filter((r) => r.status < 400);
  add(
    'js.requests',
    '脚本请求全部成功',
    scriptResponses.length > 0 && scriptOk.length === scriptResponses.length,
    `共 ${scriptResponses.length} 个，成功 ${scriptOk.length} 个`,
  );

  const staticFailures = [
    ...state.responses.filter((r) => r.url.includes('/_next/static/') && r.status >= 400),
    ...state.requestFailures.filter((r) => r.url.includes('/_next/static/') && !isIgnorable(r.url)),
  ];
  add(
    'static.noFailures',
    '/_next/static/ 无失败请求',
    staticFailures.length === 0,
    staticFailures.length === 0
      ? '无失败'
      : `${staticFailures.length} 个失败：${staticFailures
          .slice(0, 5)
          .map((r) => `${r.status ?? r.error} ${r.url}`)
          .join(' | ')}`,
  );

  const otherFailures = state.requestFailures.filter(
    (r) => !isIgnorable(r.url) && !isExpectedAbort(r.url, r.error),
  );
  const otherHttpErrors = state.responses.filter(
    (r) => r.status >= 400 && !isIgnorable(r.url) && !r.url.includes('/_next/static/'),
  );
  add(
    'resources.noFailures',
    '其他资源无失败/4xx/5xx',
    otherFailures.length === 0 && otherHttpErrors.length === 0,
    otherFailures.length === 0 && otherHttpErrors.length === 0
      ? '无失败'
      : [...otherFailures.map((r) => `${r.error} ${r.url}`), ...otherHttpErrors.map((r) => `${r.status} ${r.url}`)]
          .slice(0, 5)
          .join(' | '),
    'major',
  );

  // ---------- 2. 应用层 ----------
  const sheetsWithRules = evidence.styleSheets.filter((s) => (s.ruleCount ?? 0) > 0 && !s.disabled);
  const unparsedLinks = evidence.linkSheets.filter((l) => !l.hasSheet);
  add(
    'css.parsed',
    '样式表已解析出规则',
    sheetsWithRules.length > 0 && unparsedLinks.length === 0,
    `styleSheets ${evidence.styleSheets.length} 个，含规则 ${sheetsWithRules.length} 个` +
      `，link 未挂载 ${unparsedLinks.length} 个` +
      (unparsedLinks.length ? `：${unparsedLinks.map((l) => l.href).join(' | ')}` : ''),
  );

  add(
    'js.noPageErrors',
    '无未捕获脚本异常',
    state.pageErrors.length === 0,
    state.pageErrors.length === 0 ? '无' : state.pageErrors.map((e) => e.message).slice(0, 3).join(' | '),
  );

  add(
    'console.noErrors',
    '控制台无 error 级日志',
    state.consoleErrors.length === 0,
    state.consoleErrors.length === 0
      ? '无'
      : state.consoleErrors
          .map((e) => `${e.text}${e.location?.url ? ` @ ${e.location.url}` : ''}`)
          .slice(0, 3)
          .join(' | '),
    'major',
  );

  add('browser.alive', '浏览器未崩溃', !state.crashed, state.crashed ? 'page crash' : 'ok');

  // ---------- 3. 设计层 ----------
  add(
    'design.wrapperBg',
    '#Wrapper 灰色背景',
    evidence.styles.wrapper?.['background-color'] === DESIGN.wrapperBg,
    `期望 ${DESIGN.wrapperBg}，实际 ${evidence.styles.wrapper?.['background-color'] ?? '元素缺失'}`,
  );

  add(
    'design.bodyFont',
    'body 使用站点字体与字号',
    evidence.bodyFont.includes(DESIGN.bodyFontFamily) &&
      evidence.styles.body?.['font-size'] === DESIGN.bodyFontSize,
    `font-family="${evidence.bodyFont.slice(0, 60)}"，font-size=${evidence.styles.body?.['font-size']}`,
  );

  const box = evidence.styles.box;
  add(
    'design.boxCard',
    '.box 为白卡（白底 + 阴影 + 圆角）',
    box
      ? box['background-color'] === DESIGN.boxBg &&
        box['box-shadow'] !== 'none' &&
        box['border-radius'] === DESIGN.boxRadius
      : true,
    box
      ? `bg=${box['background-color']}, shadow=${box['box-shadow']}, radius=${box['border-radius']}`
      : '页面无 .box（不适用）',
  );

  add(
    'design.noUaLinks',
    '无浏览器默认蓝色链接（CSS 生效的直接证据）',
    evidence.counts.uaLinks === 0,
    `默认蓝链接 ${evidence.counts.uaLinks}/${evidence.counts.links} 个` +
      (evidence.uaLinkSample.length
        ? `，示例：${evidence.uaLinkSample.map((l) => l.text || l.href).join(' / ')}`
        : ''),
  );

  const content = evidence.wrappers.content;
  add(
    'design.centered',
    '内容区居中且宽度受约束',
    content
      ? content.width <= DESIGN.contentMaxWidth + 1 &&
        Math.abs(content.x - (evidence.viewport.width - content.right)) <= 24
      : false,
    content
      ? `x=${content.x}, width=${content.width}, 右侧留白=${evidence.viewport.width - content.right}`
      : '.content 缺失',
  );

  // 双栏：仅桌面视口 + 有右栏的页面才要求
  if (requireRightbar) {
    const main = evidence.wrappers.main;
    const right = evidence.wrappers.rightbar;
    const twoColumn =
      Boolean(main && right) &&
      main.visible &&
      right.visible &&
      main.right <= right.x &&
      right.width >= DESIGN.rightbarWidth - 2 &&
      right.width <= DESIGN.rightbarWidth + 2;
    add(
      'design.twoColumn',
      '主栏与右栏形成桌面双栏',
      twoColumn,
      !main || !right
        ? `#Main=${main ? 'ok' : '缺失'}, #Rightbar=${right ? 'ok' : '缺失'}`
        : `#Main x=${main.x} w=${main.width} right=${main.right}；#Rightbar x=${right.x} w=${right.width}` +
            `（要求 #Main.right ≤ #Rightbar.x，右栏宽 ${DESIGN.rightbarWidth}px）`,
    );
  }

  // ---------- 4. 稳定性 ----------
  add(
    'layout.noHorizontalOverflow',
    '无横向溢出',
    evidence.horizontalOverflow <= 1,
    `scrollWidth - innerWidth = ${evidence.horizontalOverflow}px`,
  );

  add(
    'images.allLoaded',
    '页面图片全部加载成功',
    evidence.brokenImages.length === 0,
    evidence.brokenImages.length === 0
      ? `共 ${evidence.counts.images} 张，全部成功`
      : `${evidence.brokenImages.length} 张失败：${evidence.brokenImages
          .slice(0, 3)
          .map((i) => i.src)
          .join(' | ')}`,
  );

  const ok = checks.every((c) => c.ok || c.severity !== 'blocker');
  return { ok, checks };
}

/**
 * 一站式：导航 → 等待稳定 → 采集 → 判定。
 *
 * 注意：**导航失败会直接返回失败门禁**，不抛异常让调用方「不小心继续」。
 *
 * @returns {Promise<{ok:boolean, checks:Array, evidence:object|null, state:object, stability:object|null, navigationError:string|null}>}
 */
export async function loadAndVerify(page, url, opts = {}) {
  const state = attachProbe(page);
  let navigationError = null;
  let stability = null;
  let evidence = null;

  try {
    let res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout ?? 60000 });

    /*
     * 同文档导航（只改 `#hash`）不会产生新的文档响应 ——
     * `page.goto('/t/1#reply1')` 在已经从 `/t/1` 过来时返回 null。
     * 这不是加载失败，但「没有响应」就没法验证 HTML 状态码，
     * 所以显式 reload 一次拿到真实响应；hash 与锚点滚动都会保留。
     */
    if (!res) {
      try {
        res = await page.reload({ waitUntil: 'domcontentloaded', timeout: opts.timeout ?? 60000 });
      } catch {
        /* 落到下面的 null 判定 */
      }
    }

    if (!res) navigationError = '没有收到导航响应（重载后仍无响应）';
    else if (res.status() >= 400) navigationError = `导航返回 HTTP ${res.status()}`;
  } catch (e) {
    navigationError = `导航异常：${e.message}`;
  }

  if (navigationError) {
    return {
      ok: false,
      checks: [
        {
          id: 'navigation.load',
          label: '页面成功加载',
          ok: false,
          detail: navigationError,
          severity: 'blocker',
        },
      ],
      evidence: null,
      state,
      stability: null,
      navigationError,
    };
  }

  stability = await waitForStable(page, { timeout: opts.idleTimeout ?? 30000 });
  evidence = await collectEvidence(page);

  const { ok, checks } = evaluateGates(evidence, state, opts);

  // 稳定性单列三项（它们不是「设计」而是「能不能截图」）
  checks.push({
    id: 'stability.networkIdle',
    label: '网络已静默',
    ok: stability.networkIdle,
    detail: stability.networkIdle ? 'ok' : 'networkidle 超时（可能存在长时间挂起请求）',
    severity: 'major',
  });
  checks.push({
    id: 'stability.fontsReady',
    label: '字体已就绪',
    ok: stability.fontsReady,
    detail: stability.fontsReady ? 'ok' : 'document.fonts 未进入 loaded 状态',
    severity: 'major',
  });
  checks.push({
    id: 'stability.layoutStable',
    label: '布局连续采样一致',
    ok: stability.layoutStable,
    detail: stability.layoutStable ? `第 ${stability.samples} 次采样稳定` : '12 次采样仍未稳定',
    severity: 'blocker',
  });

  const finalOk = checks.every((c) => c.ok || c.severity !== 'blocker');
  return { ok: finalOk && ok, checks, evidence, state, stability, navigationError: null };
}

/** 打印门禁结果（供 CLI 使用） */
export function formatChecks(checks) {
  return checks
    .map((c) => `${c.ok ? '✓' : c.severity === 'blocker' ? '✗' : '⚠'} [${c.id}] ${c.label} —— ${c.detail}`)
    .join('\n');
}
