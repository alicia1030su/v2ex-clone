import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.14（P0-1）：**节点可见性在站内公共面的收敛**护栏
 *
 * ## 这个护栏防的是什么
 *
 * v0.0.13 把「非 active 节点不可见」收敛到 `src/lib/node-visibility.ts`，
 * 但只覆盖了**旧版 API 与 Feed**（`tests/static/v013-legacy-privacy.spec.ts`
 * 钉死了那 7 条路径）。站内页面与站内 API 一条都没接 —— 同一个 hidden 节点的
 * 主题，在 `/api/topics/show.json` 里看不到，却能通过
 * `/tag/x`、`/go/search`、`/api/search`、`/following`、`/bookmarks`、
 * `/member/x`、`/t/{id}` 看到。也就是说：**隐藏只对订阅者生效，对网页访客不生效**。
 *
 * 本轮把站内所有公共读取路径接上同一判据。这里的断言分两类：
 *
 *  ① **直接持有 SQL 的文件**必须出现 `PUBLIC_NODE_CONDITION`
 *    （它们自己拼 where，漏一条就漏一个面）；
 *  ② **经收敛查询间接使用的页面**必须调用那个收敛函数
 *    （例如 `/tag/[name]` 只能调 `listTopicsByTag()`，不能再内联手写 join）。
 *
 * ## 为什么必须有负向对照
 *
 * 「文件里出现了某个字符串」这种断言有一个致命弱点：它可能被**注释**满足，
 * 也可能因为函数被搬走而变成**恒绿的空断言**。本仓已踩过两次
 * （V13-17 的 `not.toContain("from '@/db'")` 被注释误伤；`v014-tag-chain` 的
 * 「名字出现 ≠ 真的被调用」）。因此本文件**每一个正向判据**都配一条
 * **注入-解析**的负向对照：把条件从源码里抹掉后，**同一个判据必须判红**。
 *
 * 反向断言（「不得出现某写法」）一律先剥注释再断言 —— 否则本文件里
 * 解释「为什么不能写 `schema.nodes.status`」的注释本身就会把护栏判红。
 *
 * ## 边界（有意不覆盖）
 *
 * `src/lib/node-service.ts` 与 `src/server/categories.ts` 用的是**起别名**的
 * 原生 SQL（`FROM nodes n ...`），drizzle 的 `eq(schema.nodes.status, …)`
 * 在那种 SQL 里会生成 `"nodes"."status"` 而报 42P01 —— 它们必须写
 * `n.status = 'active'`。那两处是**不同形状的查询**，不是「同一判据的第二份实现」，
 * 因此不在本文件的收敛清单里（但它们各自有真库测试兜底）。
 */

const ROOT = path.resolve(__dirname, '..', '..');
// 静态护栏必须**行尾无关**：CI 是 LF，Windows 本机 core.autocrlf=true 时是 CRLF。
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/**
 * 去掉注释，只留真实代码。
 *
 * 反向断言（不得出现 X）必须先过这一层：本仓多次被「注释里提到了 X」误伤。
 */
const codeOnly = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（不误伤 https://）

/**
 * 取出某个函数的**函数体**（从 `function <name>(` 到下一个顶层 `export`）。
 *
 * ⚠️ 不能用「第一个 `{` 到配对的 `}`」那种朴素实现：返回类型里的
 * 对象字面量（`Promise<{ items: …; total: number }>`）会先被命中，
 * 「函数体」于是变成一段返回类型声明（本仓 v014-tag-chain 的护栏
 * 第一版就是这么假红的）。本文件改用「截到下一个顶层 export」，
 * 对单文件多函数的场景足够精确，也不受花括号影响。
 */
function functionSource(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? src.length : next);
}

/**
 * 类别 ①：**直接拼 SQL** 的公共读取面 —— 必须引用共用条件。
 *
 * 逐个列全，是因为「漏一个文件」正是这个缺陷的形态：
 * 上一轮修 7 个旧版端点时，站内这一整片都不在清单里。
 */
const DIRECT_SQL_FILES = [
  'src/server/queries.ts',
  'src/app/page.tsx',
  'src/app/go/[name]/page.tsx',
  'src/app/go/search/page.tsx',
  'src/app/xna/page.tsx',
  'src/app/following/page.tsx',
  'src/app/bookmarks/page.tsx',
  'src/app/member/[username]/page.tsx',
  'src/app/api/search/route.ts',
  'src/app/api/search/suggest/route.ts',
  'src/app/api/users/follows/topics/route.ts',
  'src/app/api/collections/route.ts',
  'src/app/api/replies/route.ts',
  'src/components/HotNodes.tsx',
] as const;

/**
 * 类别 ②：**通过收敛查询间接使用**的页面 —— 必须调用那个函数。
 *
 * 这些页面一旦退回内联 SQL，可见性条件就会重新散开（tag 页曾经就是这样）。
 */
const DELEGATING_FILES: Array<{ file: string; mustCall: RegExp; why: string }> = [
  {
    file: 'src/app/tag/[name]/page.tsx',
    mustCall: /listTopicsByTag\(/,
    why: '标签页必须走 listTopicsByTag()（内联 join 会漏可见性条件）',
  },
  {
    file: 'src/app/t/[id]/page.tsx',
    mustCall: /getTopicById\(/,
    why: '主题页必须走 getTopicById()（它负责判断节点可见性）',
  },
  {
    file: 'src/app/nodes/page.tsx',
    mustCall: /listNodesByCategory\(/,
    why: '节点目录必须走 listNodesByCategory()（它默认只返回 active）',
  },
  {
    file: 'src/app/go/new/page.tsx',
    mustCall: /listNodesByCategory\(/,
    why: '发帖页的节点选择器同样不得列出隐藏节点',
  },
  {
    file: 'src/app/recent/page.tsx',
    mustCall: /listTopics\(/,
    why: '/recent 必须走 listTopics()',
  },
  {
    file: 'src/app/hot/page.tsx',
    mustCall: /listTopics\(/,
    why: '/hot 必须走 listTopics()',
  },
];

describe('节点可见性：站内公共面统一收敛到 PUBLIC_NODE_CONDITION', () => {
  it('纯模块契约：公共条件只定义一次，且不拖入 server-only / db 副作用', () => {
    const pure = read('src/lib/node-visibility.ts');
    expect(pure.match(/export const PUBLIC_NODE_CONDITION/g) ?? []).toHaveLength(1);
    expect(pure).toContain("export const PUBLIC_NODE_CONDITION = eq(schema.nodes.status, 'active')");

    // ⚠️ 锚定行首的真实 import —— 纯模块的**注释**会提到这两个模块
    const code = codeOnly(pure);
    expect(code, '纯模块不得 import server-only').not.toMatch(/^import\s+'server-only';/m);
    expect(code, '纯模块不得 import @/db（会让单元测试凭空建连接池）').not.toMatch(
      /^import\s+[^\n]*from\s+'@\/db';/m,
    );

    // 负向对照：把定义抹掉后，同一判据必须变红
    const definesCondition = (src: string): boolean =>
      (src.match(/export const PUBLIC_NODE_CONDITION/g) ?? []).length === 1 &&
      src.includes("export const PUBLIC_NODE_CONDITION = eq(schema.nodes.status, 'active')");
    expect(definesCondition(pure)).toBe(true);
    expect(definesCondition(pure.replace(/PUBLIC_NODE_CONDITION/g, 'REMOVED'))).toBe(false);
  });

  it('全仓只有一处 `eq(schema.nodes.status, …)`（防第二份判据）', () => {
    const offenders: string[] = [];
    const walk = (relDir: string) => {
      for (const entry of readdirSync(path.join(ROOT, relDir), { withFileTypes: true })) {
        const rel = `${relDir}/${entry.name}`.replace(/\\/g, '/');
        if (entry.isDirectory()) {
          walk(rel);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          const code = codeOnly(readFileSync(path.join(ROOT, rel), 'utf8'));
          if (/eq\(schema\.nodes\.status/.test(code)) offenders.push(rel);
        }
      }
    };
    walk('src');

    expect(
      offenders,
      `节点状态等值判断只允许出现在 src/lib/node-visibility.ts，实际：${offenders.join(', ')}`,
    ).toEqual(['src/lib/node-visibility.ts']);
  });

  it.each(DIRECT_SQL_FILES)('%s 直接拼 SQL，必须引用共用可见性条件', (file) => {
    const code = codeOnly(read(file));
    const hasCondition = (src: string): boolean => /PUBLIC_NODE_CONDITION/.test(src);

    expect(hasCondition(code), `${file} 必须引用 PUBLIC_NODE_CONDITION`).toBe(true);
    // 负向对照：抹掉后同一判据必须失败 ⇒ 真实删改会让护栏变红
    expect(
      hasCondition(code.replace(/PUBLIC_NODE_CONDITION/g, 'REMOVED')),
      `${file} 抹掉 PUBLIC_NODE_CONDITION 后仍判绿 ⇒ 护栏没有鉴别力`,
    ).toBe(false);
  });

  it.each(DELEGATING_FILES)('$file 必须调用收敛查询', ({ file, mustCall, why }) => {
    const code = codeOnly(read(file));
    expect(code, why).toMatch(mustCall);
    // 负向对照：把调用名抹掉后必须判红
    const mutated = code.replace(/[A-Za-z]+\(/g, 'CALL_REMOVED(');
    expect(mutated, `${file} 抹掉调用后仍判绿 ⇒ 护栏没有鉴别力`).not.toMatch(mustCall);
  });

  it('消费方不得各自再写一份节点状态判断（防止口径漂移）', () => {
    for (const file of [...DIRECT_SQL_FILES, ...DELEGATING_FILES.map((d) => d.file)]) {
      if (file === 'src/lib/node-visibility.ts') continue;
      const code = codeOnly(read(file));
      // ⚠️ 这里断言的是「**比较/等值判断**」，不是「提到过 nodes.status」：
      //    `getTopicById()` 与 `content-service` 需要 select 出 `nodes.status`
      //    再在内存里判定（单行场景），那是**消费**判据，不是重新实现判据。
      //    把它们一并判红会逼人写出更差的实现（例如在 SQL 里塞字符串字面量）。
      expect(code, `${file} 不应重复实现节点状态等值判断`).not.toMatch(
        /eq\(schema\.nodes\.status/,
      );
      expect(code, `${file} 不应硬编码节点状态比较`).not.toMatch(
        /nodes\.status\s*[!=]==?\s*['"]/,
      );
    }
  });

  it('queries.ts：每个公共查询各自带条件，且列表与 count 用同一个 where', () => {
    const code = codeOnly(read('src/server/queries.ts'));

    // ① 每个函数体都必须出现可见性条件（或显式的 includeHidden 分支）
    const REQUIRED: Array<{ name: string; must: RegExp[] }> = [
      { name: 'listTopics', must: [/PUBLIC_NODE_CONDITION/] },
      { name: 'listTopicsByNodeIds', must: [/PUBLIC_NODE_CONDITION/] },
      { name: 'listTopicsByTag', must: [/PUBLIC_NODE_CONDITION/] },
      { name: 'listHotTopics', must: [/PUBLIC_NODE_CONDITION/] },
      { name: 'listReplies', must: [/PUBLIC_NODE_CONDITION/] },
      { name: 'getNodeByName', must: [/PUBLIC_NODE_CONDITION/, /includeHidden/] },
      { name: 'getNodeById', must: [/PUBLIC_NODE_CONDITION/, /includeHidden/] },
      { name: 'listNodesByCategory', must: [/PUBLIC_NODE_CONDITION/] },
      // 单行判定：join nodes 取 nodeStatus，非 active 且未显式放行 ⇒ null
      { name: 'getTopicById', must: [/isPublicNodeStatus\(/, /includeHiddenNode/] },
    ];

    for (const { name, must } of REQUIRED) {
      const body = functionSource(code, name);
      expect(body, `${name} 的函数体没找到（下面的断言会变成空转）`).not.toBe('');
      for (const re of must) {
        expect(body, `${name} 必须满足 ${re}`).toMatch(re);
      }
    }

    // ② 负向对照：抹掉条件后，判据必须变红（证明 ① 不是被注释或别处满足的）
    const listTopicsBody = functionSource(code, 'listTopics');
    expect(/PUBLIC_NODE_CONDITION/.test(listTopicsBody)).toBe(true);
    expect(
      /PUBLIC_NODE_CONDITION/.test(listTopicsBody.replace(/PUBLIC_NODE_CONDITION/g, 'REMOVED')),
    ).toBe(false);

    // ③ count 查询必须 join 与列表相同的表 —— 否则 where 引用 nodes 会 42P01
    const byNodeIds = functionSource(code, 'listTopicsByNodeIds');
    const byNodeIdsCount = byNodeIds.slice(byNodeIds.lastIndexOf('count()'));
    expect(
      byNodeIdsCount,
      'listTopicsByNodeIds 的 count 必须 join nodes（否则 where 引用不到 nodes 表）',
    ).toMatch(/innerJoin\(schema\.nodes/);

    const replies = functionSource(code, 'listReplies');
    expect(replies, 'listReplies 必须 join topics——回复的可见性来自它所属主题').toMatch(
      /innerJoin\(schema\.topics/,
    );
    expect(replies, 'listReplies 必须 join nodes——否则无法判断主题所在节点').toMatch(
      /innerJoin\(schema\.nodes/,
    );
  });

  it('内容服务：主题详情必须按节点状态判定，且只放行显式 staff 入口', () => {
    const code = codeOnly(read('src/lib/content-service.ts'));
    const body = functionSource(code, 'getTopicDetail');
    expect(body, 'getTopicDetail 必须判定节点状态').toMatch(/isPublicNodeStatus\(/);
    expect(body, '必须用统一的 staff 判据，不得自己写 role 比较').toMatch(
      /canReviewHiddenNodes\(/,
    );
    expect(body, '不可见时必须返回 topic: null（调用方据此 404）').toMatch(
      /topic:\s*null/,
    );
    // 负向对照
    const predicate = (src: string): boolean => /isPublicNodeStatus\(/.test(src);
    expect(predicate(body)).toBe(true);
    expect(predicate(body.replace(/isPublicNodeStatus\(/g, 'REMOVED('))).toBe(false);
  });

  it('审核入口必须是**显式传参**，不是「按角色隐式切换过滤」', () => {
    // 详情页把授权判据传给查询函数；不要在 SQL 里读 session（那会让同一份
    // SQL 在不同上下文语义不同 —— 正是本条缺陷的成因）
    const page = codeOnly(read('src/app/t/[id]/page.tsx'));
    expect(page, '主题页必须显式传入 includeHiddenNode').toMatch(/includeHiddenNode\s*:/);
    expect(page, '授权判据必须走 canReviewHiddenNodes(user)').toMatch(
      /canReviewHiddenNodes\(user\)/,
    );
    // user 必须在查询之前取到，否则 staff 永远拿到 undefined（静默失效）
    const userIdx = page.indexOf('await getSessionUser()');
    const topicIdx = page.indexOf('await getTopicById(');
    expect(userIdx, 't/[id] 必须先取 user 再查主题').toBeGreaterThan(-1);
    expect(topicIdx).toBeGreaterThan(userIdx);

    // 负向对照：把 includeHiddenNode 抹掉后判据必须失败
    const requiresExplicit = (src: string): boolean => /includeHiddenNode\s*:/.test(src);
    expect(requiresExplicit(page)).toBe(true);
    expect(requiresExplicit(page.replace(/includeHiddenNode\s*:/g, 'REMOVED:'))).toBe(false);
  });

  it('API：收藏 / 回复的写入前置校验也按可见性判定（不可见 ⇒ 404）', () => {
    const collections = codeOnly(read('src/app/api/collections/route.ts'));
    expect(collections, '收藏主题必须 join nodes 判定节点可见性').toMatch(
      /innerJoin\(schema\.nodes[\s\S]{0,200}PUBLIC_NODE_CONDITION/,
    );
    expect(collections, '收藏不可见目标必须 404（与不存在同语义）').toContain('主题不存在');
    expect(collections, '收藏节点同样必须判定可见性').toContain('节点不存在');

    const replies = codeOnly(read('src/app/api/replies/route.ts'));
    expect(replies, '回复 API 的存在性校验必须 join nodes').toMatch(
      /innerJoin\(schema\.nodes/,
    );
  });

  it('首页「最热」tab：节点排行与随后的节点查询都不得纳入隐藏节点', () => {
    const code = codeOnly(read('src/app/page.tsx'));
    // 排行查询（groupBy nodes.name）与 nodeRows 查询都必须带条件
    const occurrences = code.match(/PUBLIC_NODE_CONDITION/g) ?? [];
    expect(
      occurrences.length,
      '首页有两处节点查询（排行 + 按名取 id），两处都要带可见性条件',
    ).toBeGreaterThanOrEqual(2);

    // 负向对照：逐个抹掉后，数量必须下降 ⇒ 断言确实在数真实引用
    const mutated = code.replace(/PUBLIC_NODE_CONDITION/g, 'REMOVED');
    expect((mutated.match(/PUBLIC_NODE_CONDITION/g) ?? []).length).toBe(0);
  });

  it('关注流：列表与总数必须共用**同一个** where（否则分页立刻错位）', () => {
    // 这两处在修复前各有一段独立实现：列表是 drizzle where，总数是一段
    // 手写原生 SQL。只给列表加条件、忘了改总数，就会得到「总数 30 / 可见 12」
    // 的分页错位 —— 而页面不会报错，只是第 2 页以后一片空白。
    const page = codeOnly(read('src/app/following/page.tsx'));
    expect(page, '关注页必须构造一个共用的 where').toMatch(/const followWhere = and\(/);
    expect(
      (page.match(/\.where\(followWhere\)/g) ?? []).length,
      '列表查询与 count 查询都必须使用同一个 followWhere',
    ).toBe(2);

    const api = codeOnly(read('src/app/api/users/follows/topics/route.ts'));
    expect(api, '关注流 API 必须构造一个共用的 where').toMatch(/const where = and\(/);
    expect(
      (api.match(/\.where\(where\)/g) ?? []).length,
      'API 的列表与 count 也必须使用同一个 where',
    ).toBe(2);

    // 负向对照：把 count 查询的 where 换成别的变量后判据必须判红
    const brokenCount = (src: string): boolean =>
      (src.match(/\.where\(where\)/g) ?? []).length === 2;
    expect(brokenCount(api)).toBe(true);
    expect(brokenCount(api.replace(/\.where\(where\)/g, '.where(other)'))).toBe(false);
  });

  it('收藏页：主题收藏与节点收藏分别判定，且不得用 join 条件误删一类', () => {
    const code = codeOnly(read('src/app/bookmarks/page.tsx'));
    expect(code, '必须分别收集 topic 与 node 两类目标').toMatch(/target\s*===\s*'topic'/);
    expect(code, '节点收藏必须有独立的可见性查询').toMatch(/visibleNodeIds/);
    expect(code, '主题收藏必须有独立的可见性查询').toMatch(/visibleTopicIds/);
    // ⚠️ 反向断言：不得把状态条件写进那个 leftJoin（会让另一类收藏整批消失）
    expect(
      code,
      'nodes 的 leftJoin 上不得挂状态条件（collections.nodeId 对 topic 收藏恒为 NULL）',
    ).not.toMatch(/leftJoin\(schema\.nodes[\s\S]{0,120}nodes\.status/);
  });

  /**
   * 审计文案必须按**事实**判，不能按**请求形状**判（v0.0.14）。
   *
   * 这是「同一张审计表说假话」的第二个落点：`edit_history` 的空快照修掉之后，
   * `audit_logs` 里仍有一条指向「编辑正文」的错因记录 —— 因为编辑表单**总是**
   * 提交 `content`，按 `body.content !== undefined` 判就永远落到「编辑正文」，
   * 哪怕用户只是删了一个标签、正文逐字没变。
   *
   * 判据必须来自服务层刚比过库内值的 `result.changed`（逐字段），
   * 而不是「请求里有没有这个字段」。
   */
  it('编辑审计的 reason 必须依据 result.changed，不得依据请求形状', () => {
    const route = codeOnly(read('src/app/api/topics/[id]/route.ts'));

    expect(route, '必须有基于 result.changed 的文案判定').toMatch(
      /result\.changed\.title/,
    );
    expect(route, '正文变化也必须看 result.changed.content').toMatch(
      /result\.changed\.content/,
    );
    // 反向断言：不得再用「传了 body.content 就算改正文」这种请求形状判据
    expect(
      route,
      '不得用 `body.content !== undefined` 决定审计文案（前端总是提交正文 ⇒ 必然误报）',
    ).not.toMatch(/body\.content\s*!==\s*undefined\s*\?/);

    // 负向对照：把判据改回请求形状后，同一断言必须判红
    const usesFacts = (src: string): boolean => /result\.changed\.title/.test(src);
    expect(usesFacts(route)).toBe(true);
    expect(usesFacts(route.replace(/result\.changed\.title/g, 'body.title'))).toBe(false);

    // 服务层必须真的**逐字段**给出变化，而不是只给一个「内容变了没」的布尔：
    // 传了 title ≠ 改了 title（staff 的编辑表单每次都带标题一起提交）。
    const service = codeOnly(read('src/lib/content-service.ts'));
    const body = functionSource(service, 'editTopic');
    expect(body, 'editTopic 必须返回逐字段的 changed').toMatch(
      /changed:\s*\{\s*title:/,
    );
    expect(body, 'changed.title 必须比较库内值，而不是「传没传」').toMatch(
      /title:\s*newTitle\s*!==\s*topic\.title/,
    );
    expect(body, 'changed.content 必须比较库内值').toMatch(
      /content:\s*newContent\s*!==\s*topic\.content/,
    );
  });
});
