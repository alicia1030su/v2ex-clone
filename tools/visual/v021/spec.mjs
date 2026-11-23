/** Deterministic v0.0.21 visual audit specification: 18 × 5 × 6 = 540. */

export const SEED_TIME_ANCHOR = '2026-11-06T04:00:00.000Z';

export const VIEWPORTS = Object.freeze([
  Object.freeze({ id: 'VP375', name: 'mobile-375', width: 375, height: 812, isMobile: true, hasTouch: true }),
  Object.freeze({ id: 'VP390', name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true }),
  Object.freeze({ id: 'VP768', name: 'tablet-768', width: 768, height: 1024, isMobile: false, hasTouch: false }),
  Object.freeze({ id: 'VP1280', name: 'desktop-1280', width: 1280, height: 900, isMobile: false, hasTouch: false }),
  Object.freeze({ id: 'VP1920', name: 'desktop-1920', width: 1920, height: 1080, isMobile: false, hasTouch: false }),
]);

export const LAYERS = Object.freeze([
  Object.freeze({ id: 'L1', name: 'reference-eligibility', selector: 'reference-manifest', probes: ['reference.eligibility'] }),
  Object.freeze({ id: 'L2', name: 'macro-geometry', selector: '#Top,#Wrapper,#Main,#Rightbar,.box,.cell,.pager,form', probes: ['geometry.boxes', 'geometry.overflow', 'geometry.overlap'] }),
  Object.freeze({ id: 'L3', name: 'design-tokens', selector: 'body,#Top,#Main,.box,.cell,a,button,input', probes: ['styles.computed', 'styles.tokens'] }),
  Object.freeze({ id: 'L4', name: 'dom-aria', selector: 'main,header,nav,footer,h1,h2,form,label,button,a', probes: ['dom.landmarks', 'dom.labels', 'dom.order', 'dom.aria'] }),
  Object.freeze({ id: 'L5', name: 'interaction-a11y', selector: 'a,button,input,select,textarea,[tabindex]', probes: ['interaction.focus', 'interaction.keyboard', 'interaction.states', 'a11y.contrast', 'a11y.reducedMotion'] }),
  Object.freeze({ id: 'L6', name: 'responsive-robustness', selector: 'html,body,#Wrapper,#Main', probes: ['responsive.viewport', 'responsive.zoom200', 'responsive.overflow', 'robust.dataStates', 'robust.missingImage', 'robust.theme'] }),
]);

const PAGE_CLASSES = [
  { id: 1, slug: 'home', name: '首页', routes: ['/', '/?tab=hot', '/?tab=all', '/?tab=r2'], states: ['0/1/multiple topics', 'tab hot/all/r2'], roles: ['guest'], selectors: ['#Top', '#Wrapper', '#Main', '#Rightbar', '.cell.item', '.tab_current'] },
  { id: 2, slug: 'topic-list', name: '主题列表/分页', routes: ['/recent', '/hot', '/recent?page=2'], states: ['first/middle/last page', '0/1/multiple topics'], roles: ['guest'], selectors: ['#Main', '.cell.item', '.item_title', '.pager', 'a.page_normal'] },
  { id: 3, slug: 'following', name: '关注流', routes: ['/following'], states: ['empty', 'non-empty'], roles: ['guest', 'user'], selectors: ['#Main', '.cell.item', '.empty-state'] },
  { id: 4, slug: 'nodes', name: '节点总览', routes: ['/nodes'], states: ['0/1/multiple categories'], roles: ['guest'], selectors: ['#Main', '.category', '.node-item', 'a.item_node'] },
  { id: 5, slug: 'node-detail', name: '节点详情', routes: ['/go/{nodeName}'], states: ['0/1/multiple topics', 'long description'], roles: ['guest'], selectors: ['#Main', '#Rightbar', '.cell', '.item_title', '.node-description'] },
  { id: 6, slug: 'topic-detail', name: '主题详情', routes: ['/t/{topicId}'], states: ['long title', 'long body', 'no replies', 'locked'], roles: ['guest', 'user'], selectors: ['#Main', '#Rightbar', '.topic-header', '.topic-content', '.reply-box'] },
  { id: 7, slug: 'reply-modes', name: '七种回复模式', routes: ['/t/{topicId}?reply={replyMode}'], states: ['classic', 'quote', 'badge', 'nested', 'tree', 'lines', 'excerpt'], roles: ['guest', 'user'], selectors: ['#Main', '.reply-list', '.reply-item', '.reply-content', '.reply-operation'] },
  { id: 8, slug: 'member', name: '用户页', routes: ['/member/{username}'], states: ['0/1/multiple topics', 'long bio', 'missing avatar'], roles: ['guest', 'user'], selectors: ['#Main', '#Rightbar', '.profile', '.avatar', '.cell.item'] },
  { id: 9, slug: 'signin', name: '登录', routes: ['/signin'], states: ['default', 'invalid credentials', 'captcha disabled in test'], roles: ['guest'], selectors: ['#Main', 'form', '#username', '#password', 'button[type="submit"]'] },
  { id: 10, slug: 'account-recovery', name: '注册与账号恢复', routes: ['/signup', '/forgot', '/reset-password'], states: ['default', 'validation error', 'success'], roles: ['guest'], selectors: ['#Main', 'form', 'input', 'button[type="submit"]'] },
  { id: 11, slug: 'settings', name: '设置', routes: ['/settings'], states: ['default', 'saved', 'validation error'], roles: ['user'], selectors: ['#Main', 'form', 'input', 'button[type="submit"]'] },
  { id: 12, slug: 'notifications', name: '通知', routes: ['/notifications'], states: ['empty', 'unread', 'read'], roles: ['user'], selectors: ['#Main', '.notification', '.empty-state', 'a'] },
  { id: 13, slug: 'bookmarks', name: '收藏', routes: ['/bookmarks'], states: ['empty', '1/multiple bookmarks'], roles: ['user'], selectors: ['#Main', '.cell.item', '.empty-state'] },
  { id: 14, slug: 'search', name: '搜索', routes: ['/go/search?q={query}'], states: ['no results', 'results', 'suggestions'], roles: ['guest'], selectors: ['#Main', '#search', '.search-result', '.empty-state'] },
  { id: 15, slug: 'tag', name: '标签页', routes: ['/tag/{tagName}'], states: ['empty', '1/multiple topics'], roles: ['guest'], selectors: ['#Main', '.tag-header', '.cell.item', '.empty-state'] },
  { id: 16, slug: 'leaderboard', name: '积分榜', routes: ['/leaderboard'], states: ['0/1/multiple users'], roles: ['guest'], selectors: ['#Main', '.leaderboard', '.rank-row'] },
  { id: 17, slug: 'admin-reports', name: '管理与举报', routes: ['/admin', '/reports'], states: ['guest', 'user', 'moderator', 'admin'], roles: ['guest', 'user', 'moderator', 'admin'], selectors: ['#Main', 'table', 'form', 'button', '.admin-panel'] },
  { id: 18, slug: 'static-help', name: '静态、帮助与发布入口', routes: ['/about', '/faq', '/privacy', '/worldclock', '/xna', '/nodes/request', '/go/new'], states: ['default', 'long content', 'form error'], roles: ['guest', 'user'], selectors: ['#Main', 'article', 'form', 'a'] },
];

export const PAGE_CLASS_SPECS = Object.freeze(PAGE_CLASSES.map((entry) => Object.freeze(entry)));

function resolveRoute(route, fixtures = {}) {
  return route
    .replace('{nodeName}', String(fixtures.nodeName ?? 'claude'))
    .replace('{topicId}', String(fixtures.topicId ?? 1))
    .replace('{username}', String(fixtures.username ?? 'admin'))
    .replace('{tagName}', String(fixtures.tagName ?? 'visual-audit'))
    .replace('{query}', String(fixtures.query ?? 'claude'))
    .replace('{replyMode}', String(fixtures.replyMode ?? 'classic'));
}

/**
 * Build the deterministic 540-record matrix.
 *
 * @param {{commit:string, capturedAt:string, fixtures?:object, owner?:string}} options
 * @returns {object[]}
 */
export function buildMatrixRecords(options) {
  const records = [];
  const capturedAt = options.capturedAt;
  const owner = options.owner ?? 'software-engineer-2';
  for (const pageClass of PAGE_CLASS_SPECS) {
    for (const viewport of VIEWPORTS) {
      for (const layer of LAYERS) {
        const gapId = `V21-P${String(pageClass.id).padStart(2, '0')}-${viewport.id}-${layer.id}-R01`;
        const primaryRoute = resolveRoute(pageClass.routes[0], options.fixtures);
        const severity = layer.id === 'L5' || layer.id === 'L6' ? 'P1' : 'P0';
        records.push({
          gap_id: gapId,
          page_class: pageClass.slug,
          page_class_name: pageClass.name,
          route: primaryRoute,
          auth_role: pageClass.roles[0],
          viewport: viewport.name,
          viewport_id: viewport.id,
          layer: layer.id,
          layer_name: layer.name,
          reference_id: 'NONE-OFFICIAL-PIXEL-SPEC',
          reference_url_or_path: null,
          captured_at: capturedAt,
          legal_basis: 'No eligible official pixel specification; project-owned before evidence is regression-only.',
          baseline_selector: layer.selector,
          baseline_value: null,
          current_selector: pageClass.selectors.join(','),
          current_value: null,
          delta: { status: 'not-comparable', reason: 'NO_ELIGIBLE_OFFICIAL_PIXEL_REFERENCE' },
          classification: 'E',
          severity,
          status: 'UNVERIFIED',
          evidence_before: `docs/evidence/visual/v0.0.21/before/${gapId}/metadata.json`,
          evidence_after: null,
          owner,
          commit: options.commit,
          retest_result: 'not-run',
          notes: 'Official geometry/style/reference is unavailable. Current implementation evidence is collected for regression and accessibility contracts only; no official pixel claim is made.',
          states: [...pageClass.states],
          routes: pageClass.routes.map((route) => resolveRoute(route, options.fixtures)),
          probe_results: layer.probes.map((probe) => ({ probe, status: 'recorded', evidence: null })),
          p0_blocking: severity === 'P0',
          closure_allowed: false,
        });
      }
    }
  }
  return records;
}

export { resolveRoute };
