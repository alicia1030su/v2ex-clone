import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildNavLinks, type NavLink, type NavUser } from '../../src/lib/nav-links';

/**
 * 孤儿页可达性护栏（v0.0.14）
 *
 * ## 这个护栏防的是什么
 *
 * `/hot`（热门）与 `/recent`（最新）两个页面**早已实现且可用**，
 * 但全站**没有任何链接指向它们** —— 实测 `grep` 全文只有页面自身命中。
 * 于是它们是「孤儿页」：功能存在，用户不可达，只能手输 URL。
 *
 * 这与 v0.0.4 的 `/admin` 入口缺失是**同一类缺陷**：
 * 「页面/表/接口都存在」不等于「链路接通」。
 * 静态护栏若只检查「文件存在」，这类缺口必然全绿 ——
 * 所以本护栏**不看文件是否存在**，只看**导航数据里是否有入口**。
 *
 * ## 为什么是纯函数断言
 *
 * `src/lib/nav-links.ts` 是纯模块（无 db / server-only 依赖），
 * 因此可以直接 import `buildNavLinks` 断言**返回值**，
 * 而不是用正则去猜源码写了什么。返回值断言更接近真实行为：
 * 就算有人把 `CONTENT_LINKS` 在某个分支里 `filter()` 掉了，
 * 断言依然会红。
 *
 * 注意：本文件用**相对路径** import（`../../src/lib/nav-links`），
 * 而不是 `@/lib/nav-links` —— `vitest.static.config.ts` 刻意不配 alias，
 * 静态测试应当是「零配置、不碰任何运行环境」的。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** 需要入口的两条全局内容路由 */
const REQUIRED_HREFS = ['/hot', '/recent'] as const;

/** 游客、登录用户、版主、管理员 —— 四种身份都必须可达 */
const IDENTITIES: Array<{ name: string; user: NavUser }> = [
  { name: '游客', user: null },
  { name: '普通用户', user: { username: 'u', role: 'user' } },
  { name: '版主', user: { username: 'm', role: 'moderator' } },
  { name: '管理员', user: { username: 'a', role: 'admin' } },
];

/**
 * 判据 ①：给定链接数组，是否包含指定 href。
 *
 * 抽成具名函数是为了让**负向对照**能复用同一个判据 ——
 * 否则「负向对照」只证明了「我另写的那个表达式会失败」，
 * 而不是「护栏用的判据有鉴别力」。
 */
function hasHref(links: readonly NavLink[], href: string): boolean {
  return links.some((l) => l.href === href);
}

/**
 * 判据 ②：给定源文本，某 href 字符串字面量出现几次。
 *
 * 用于防「重复添加」——若游客组与登录组各写一遍，
 * 该 href 就会出现两次，改文案时极易漏改一处。
 */
function countOccurrences(src: string, href: string): number {
  return src.split(`'${href}'`).length - 1;
}

describe('v0.0.14 · /hot 与 /recent 不得是孤儿页', () => {
  it('所有身份（游客 / 用户 / 版主 / 管理员）的导航都含 /hot 与 /recent', () => {
    for (const identity of IDENTITIES) {
      const links = buildNavLinks(identity.user);
      for (const href of REQUIRED_HREFS) {
        expect(
          hasHref(links, href),
          `${identity.name}的导航缺少 ${href} 入口 ⇒ 该页面不可达`,
        ).toBe(true);
      }
    }
  });

  it('入口位置紧跟「首页」之后（内容入口不得埋在用户工具区里）', () => {
    const links = buildNavLinks({ username: 'u', role: 'user' });
    // 首页固定第一位；热门 / 最新紧随其后
    expect(links[0].href).toBe('/');
    expect(links.slice(1, 3).map((l) => l.href)).toEqual(['/hot', '/recent']);
  });

  it('导航链接的 href 全局唯一（不会渲染出重复链接）', () => {
    for (const identity of IDENTITIES) {
      const hrefs = buildNavLinks(identity.user).map((l) => l.href);
      expect(
        hrefs,
        `${identity.name}的导航出现重复 href`,
      ).toEqual([...new Set(hrefs)]);
    }
  });

  it('导航链接的 key 稳定（NavTools 按 href:label 渲染而非数组索引）', () => {
    const nav = read('src/components/NavTools.tsx');
    // 按索引当 key 时，插入新链接会让 React 复用错节点（状态错位）
    expect(nav, 'NavTools 不得用数组索引作为 key').not.toMatch(/key=\{?i(ndex)?\}?/);
    expect(nav, 'NavTools 必须以 href 参与 key，保证插入新链接后节点身份稳定').toMatch(
      /key=\{`?\$\{l\.href\}/,
    );
  });

  it('nav-links.ts 里 /hot 与 /recent 各只出现一次（单一事实来源）', () => {
    const src = read('src/lib/nav-links.ts');
    for (const href of REQUIRED_HREFS) {
      expect(
        countOccurrences(src, href),
        `${href} 在 nav-links.ts 里必须恰好出现 1 次（多处各写一遍会在下次改动时漏改）`,
      ).toBe(1);
    }
  });

  /**
   * 负向对照：证明上面的判据**有鉴别力**。
   *
   * 构造一份「删掉 /hot 项」的纯数据副本，用**同一个判据**判定 ——
   * 若判据只会返回 true（例如写成了 `expect(true).toBe(true)`），
   * 这条断言就会红。这是本仓反复强调的「护栏必须被负向对照验证」。
   */
  it('负向对照：删掉 /hot 后判据必须失败（证明断言有鉴别力）', () => {
    const real = buildNavLinks(null);
    const damaged = real.filter((l) => l.href !== '/hot');

    expect(hasHref(real, '/hot'), '真实数据应含 /hot').toBe(true);
    expect(hasHref(damaged, '/hot'), '被破坏的数据不应含 /hot').toBe(false);

    // 同理验证「出现次数」判据：删掉后次数归零，重复写两遍则为 2
    const realSrc = read('src/lib/nav-links.ts');
    const duplicatedSrc = realSrc.replace(
      "'/hot', label: '热门' },",
      "'/hot', label: '热门' }, { href: '/hot', label: '热门' },",
    );
    expect(countOccurrences(realSrc, '/hot')).toBe(1);
    expect(countOccurrences(duplicatedSrc, '/hot')).toBe(2);
  });

  it('两个页面本身仍然存在且不是空壳（入口指向的页面必须有实现）', () => {
    const hot = read('src/app/hot/page.tsx');
    const recent = read('src/app/recent/page.tsx');
    expect(hot, '/hot 页面必须有实际内容渲染').toMatch(/export default/);
    expect(recent, '/recent 页面必须有实际内容渲染').toMatch(/export default/);
  });
});
