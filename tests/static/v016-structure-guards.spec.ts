import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.16 结构缺陷静态护栏
 *
 * ## 防的是「HTTP 200、无报错、截图看着也正常」的那一类缺陷
 *
 * 本仓历史上反复出现的不是「页面打不开」，而是**结构/数据错位**：
 *
 *   ① `.box > .cell > .cell` 嵌套 —— 匿名访客看到一个空的 21px cell，
 *      把回复头从一行拆成三段；登录用户则看到操作按钮长在「N 条回复」里。
 *      页面 200、无控制台错误、肉眼也容易忽略。
 *
 *   ② `lastReplier` 硬编码 `null` + 组件 `?? author.username` 兜底 ——
 *      结果「最热」tab 每一行都写着「最后回复来自 <楼主>」。
 *      数据是错的，但页面完全正常。
 *
 *   ③ FAQ 里 `/member/`（缺用户名）—— 点到就是 404，但没人点就永远发现不了。
 *
 * 这些缺陷的共同点是**只能靠结构断言抓**。本文件把它们钉死：
 * 任何一次「重构页面时顺手把嵌套写回去」「把 null 填回查询里」
 * 都会在这里立刻变红，而且失败信息直接指向后果。
 *
 * ⚠️ 本文件用**相对路径**与纯读文件（`vitest.static.config.ts` 刻意不配 alias），
 * 静态测试必须零配置、不碰运行环境。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** 去掉注释与字符串字面量的粗略清洗：只用于「结构」判断，不追求完备 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(?<!:)\/\/.*$/gm, '');
}

describe('v0.0.16 结构护栏 ①：主题页不得出现 .box > .cell > .cell 嵌套', () => {
  const FILE = 'src/app/t/[id]/page.tsx';

  it('TopicActions 必须渲染在回复区的 box 之外（历史上它被写进了回复头 cell 里面）', () => {
    const src = stripComments(read(FILE));

    // 恢复区容器（`<div id="topic-replies">`）之前的最后一段
    const repliesIdx = src.indexOf('id="topic-replies"');
    expect(repliesIdx, `${FILE} 里找不到 #topic-replies —— 断言锚点失效，本用例无意义`).toBeGreaterThan(
      0,
    );

    const beforeReplies = src.slice(0, repliesIdx);

    // ① TopicActions 必须在回复区**之前**（主题内容区里）
    expect(
      beforeReplies.includes('<TopicActions'),
      'TopicActions 不在 #topic-replies 之前 —— 说明它又被写进了回复区，' +
        '形成 .box > .cell > .cell 嵌套，匿名访客会看到一个空的 21px cell',
    ).toBe(true);

    // ② 回复区里不得再出现 TopicActions
    const afterReplies = src.slice(repliesIdx);
    expect(
      afterReplies.includes('<TopicActions'),
      '回复区里出现了 TopicActions —— 这就是 v0.0.15 之前的嵌套缺陷（回复头被拆成三段）',
    ).toBe(false);
  });

  it('回复头 cell 内不得再嵌套 cell（只有 fr 的标签与计数文本）', () => {
    const src = stripComments(read(FILE));
    const repliesIdx = src.indexOf('id="topic-replies"');
    const afterReplies = src.slice(repliesIdx);

    // 取回复区第一个 .box 的头部：从 `<div className="cell">` 到「条回复」
    const headStart = afterReplies.indexOf('<div className="cell">');
    expect(headStart, '回复区第一个 cell 不存在 —— 锚点失效').toBeGreaterThanOrEqual(0);
    const headEnd = afterReplies.indexOf('条回复', headStart);
    expect(headEnd, '回复头里找不到「条回复」—— 锚点失效').toBeGreaterThan(0);

    const head = afterReplies.slice(headStart + '<div className="cell">'.length, headEnd);
    expect(
      head.includes('<div className="cell"'),
      '回复头内部又嵌套了一个 <div className="cell"> —— 这就是被修掉的嵌套缺陷',
    ).toBe(false);
  });
});

describe('v0.0.16 结构护栏 ②：三个列表查询都必须真的算最后回复者', () => {
  const FILE = 'src/server/queries.ts';

  it('不得再出现 `lastReplier: null` 的硬编码（它就是「最热」tab 显示楼主的根因）', () => {
    const src = stripComments(read(FILE));
    expect(
      src.includes('lastReplier: null'),
      'queries.ts 里又出现了 `lastReplier: null` —— ' +
        '组件会用作者名兜底，于是该页每一行都显示「最后回复来自 <楼主>」',
    ).toBe(false);
  });

  it('三个公共列表（listTopics / listTopicsByNodeIds / listTopicsByTag）都走 loadLastRepliers', () => {
    const src = stripComments(read(FILE));
    const hits = src.match(/loadLastRepliers\(/g) ?? [];
    // 1 处定义 + 3 处调用
    expect(
      hits.length,
      `loadLastRepliers 只被引用 ${hits.length - 1} 次（期望 3 次：listTopics / listTopicsByNodeIds / listTopicsByTag）`,
    ).toBeGreaterThanOrEqual(4);
  });

  it('组件不得用作者名兜底最后回复者', () => {
    const FILE2 = 'src/components/TopicItem.tsx';
    const src = stripComments(read(FILE2));
    expect(
      /lastReplier\?\.username\s*\?\?\s*topic\.author\.username/.test(src),
      'TopicItem 又用了 `lastReplier?.username ?? author.username` —— ' +
        '这把「没有数据」伪装成「数据是楼主」，是看不出来的错误',
    ).toBe(false);
  });
});

describe('v0.0.16 结构护栏 ③：站内链接不得指向缺参数的动态路由', () => {
  it('FAQ 里不得出现裸 /member/ 链接（它必然 404）', () => {
    const src = stripComments(read('src/app/faq/page.tsx'));
    expect(
      /\/member\/["'`]/.test(src),
      'FAQ 里出现了 `/member/`（缺少用户名）—— 点击即 404。' +
        '应改为指向当前用户的个人主页或 /member 的合法入口',
    ).toBe(false);
  });

  it('全站不得出现裸 /member/ 字面量（排除已带用户名的模板）', () => {
    const files = [
      'src/app/faq/page.tsx',
      'src/components/Footer.tsx',
      'src/components/SiteNav.tsx',
      'src/components/NavTools.tsx',
    ];
    const offenders: string[] = [];
    for (const f of files) {
      let src = '';
      try {
        src = stripComments(read(f));
      } catch {
        continue;
      }
      // 匹配 href="/member" 或 href="/member/"（引号闭合，说明没有用户名）
      const hit = src.match(/href=["']\/member\/?["']/);
      if (hit) offenders.push(`${f}: ${hit[0]}`);
    }
    expect(offenders, `发现裸 /member 链接（点击 404）：${offenders.join(' / ')}`).toEqual([]);
  });
});

describe('v0.0.16 交互护栏：异步校准不得覆盖用户已操作的状态', () => {
  /**
   * ## 这条护栏防的具体现象
   *
   * `CollectButton` 挂载时会拉一次「我是否已收藏」来校准。这份拉取与用户点击
   * **并发**：用户在 fetch 返回前点了收藏，后端已写入、UI 已切到「已收藏」，
   * 随后那个更早发出的 fetch 返回「未收藏」，把状态覆盖回去。
   *
   * 表现是：点收藏 → 变「已收藏」→ 一两秒后自己变回「收藏」，
   * 刷新又显示已收藏（数据库对、UI 错）。这类缺陷不产生任何报错。
   *
   * 修法是「用户操作过就丢弃校准结果」（`userActedRef`）。
   * 静态断言只能锁住**这个机制存在**；真正的时序验证在 E2E。
   */
  const FILE = 'src/components/CollectButton.tsx';

  it('挂载校准必须先检查 userActedRef，再 setCollected', () => {
    const src = stripComments(read(FILE));
    // 找 useEffect 里的 setCollected 调用
    const effectIdx = src.indexOf('useEffect(');
    expect(effectIdx, `${FILE} 里找不到 useEffect —— 结构已变，本用例需重写`).toBeGreaterThan(0);
    const effectBody = src.slice(effectIdx, src.indexOf('}, [target, id]);', effectIdx));

    expect(
      effectBody.includes('userActedRef.current'),
      '挂载校准直接 setCollected 而不检查 userActedRef —— ' +
        '用户点击与校准并发时，后者会覆盖前者（点了收藏又自己变回去）',
    ).toBe(true);
  });

  it('toggle 必须做并发点击保护（pending 期间直接 return）', () => {
    const src = stripComments(read(FILE));
    expect(
      /if\s*\(\s*pending\s*\)\s*return/.test(src),
      'toggle 缺少 `if (pending) return` —— 快速双击会发出两个 POST，' +
        '最终 UI 状态取决于哪个响应后到',
    ).toBe(true);
  });
});
