import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  toLegacyMember,
  toLegacyNode,
  toLegacyTopic,
  type LegacyMemberInput,
  type LegacyNodeInput,
} from '../../src/lib/legacy-topic-api';

/**
 * v0.0.13（V13-01）：**跨接口字段一致性 + 权限 + 隐私**护栏
 *
 * 任务书点名禁止的六类问题里，有四类可以在**纯静态层**钉死：
 *   · 邮箱 / 密码哈希 / 会话令牌 / 积分余额被公开
 *   · 已删除内容从公共接口泄露
 *   · 被封禁用户的隐藏信息意外暴露
 *   · 每条 API 各自拼装字段 ⇒ 同一实体值不同
 *
 * 另外两类（同节点 stars 不同、同主题回复数不同 / 时间戳 / 排序）
 * 需要真实数据库，放在 `e2e/v013-legacy-api.spec.ts`。
 *
 * 这里的策略是「**结构上不可能**」而不是「测试时碰巧没出现」：
 * 所有旧版端点共用 `src/server/legacy-assemblers.ts`，
 * 静态断言禁止任何端点再自己 import `avatarUrl` 或查 `collections`。
 */

const ROOT = path.resolve(__dirname, '../..');
// 静态护栏必须**行尾无关**：CI 是 LF，Windows 本机 core.autocrlf=true 时是 CRLF。
// 不归一化时，`toContain('a\n    ? b')` 这类多行断言会在本机假红、在 CI 假绿。
const read = (p: string) =>
  readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const member: LegacyMemberInput = {
  id: 7,
  username: 'lisi',
  tagline: 'hello',
  bio: 'bio',
  url: 'https://example.test',
  location: 'Shanghai',
  createdAt: new Date('2024-01-02T03:04:05Z'),
  lastActiveAt: new Date('2026-11-08T00:00:00Z'),
  avatars: {
    mini: 'a', normal: 'b', large: 'c',
    xlarge: 'd', xxlarge: 'e', xxxlarge: 'f',
  },
};

const node: LegacyNodeInput = {
  id: 3,
  name: 'python',
  title: 'Python',
  topicsCount: 42,
  stars: 5,
  founderId: 1,
  parentNodeName: 'programming',
  avatars: { mini: 'a', normal: 'b', large: 'c' },
};

/** 无论嵌套多深，都不允许出现的私有字段名 */
const PRIVATE_KEYS = [
  'email', 'password', 'passwordHash', 'password_hash',
  'session', 'sessionToken', 'session_token', 'token',
  'balance', 'csrf', 'deletedBy', 'deletedReason',
];

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe('旧版公开载荷绝不携带私有字段', () => {
  it('member / node / topic 三种载荷的键集合都不含私密字段', () => {
    const payloads = [
      toLegacyMember(member, 'https://example.test'),
      toLegacyNode(node, 'https://example.test'),
      toLegacyTopic({
        id: 1, title: 't', content: 'c', contentHtml: '<p>c</p>',
        repliesCount: 2, createdAt: new Date('2024-01-02T03:04:05Z'),
        editedAt: null, lastReplyAt: new Date('2024-01-03T03:04:05Z'),
        deleted: false, lastReplyBy: 'wangwu', member, node,
      }, 'https://example.test'),
    ];
    for (const p of payloads) {
      const keys = collectKeys(p);
      for (const secret of PRIVATE_KEYS) {
        expect(keys, `载荷里不应出现 ${secret}`).not.toContain(secret);
      }
    }
  });

  it('member 载荷恰好是原站的 20 键（不多不少，形状不漂移）', () => {
    expect(Object.keys(toLegacyMember(member, 'https://example.test'))).toHaveLength(20);
  });

  it('node 载荷恰好是原站的 16 键', () => {
    expect(Object.keys(toLegacyNode(node, 'https://example.test'))).toHaveLength(16);
  });
});

describe('共用装配器：结构上杜绝「同一实体不同接口值不同」', () => {
  const routes = [
    'src/app/api/topics/show.json/route.ts',
    'src/app/api/topics/latest.json/route.ts',
    'src/app/api/topics/hot.json/route.ts',
    'src/app/api/members/show.json/route.ts',
    'src/app/api/nodes/show.json/route.ts',
    'src/app/api/nodes/all.json/route.ts',
    'src/app/api/nodes/list.json/route.ts',
    'src/app/api/replies/show.json/route.ts',
  ];

  it.each(routes)('%s 不再自行拼装头像或收藏数', (file) => {
    const src = read(file);
    expect(src).not.toContain("from '@/components/Avatar'");
    expect(src).not.toContain('MEMBER_AVATAR_SIZES');
    expect(src).not.toContain('NODE_AVATAR_SIZES');
    expect(src).not.toContain('schema.collections');
  });

  it('主题 / 节点 / 回复 / 会员装配全部经过 legacy-assemblers', () => {
    for (const file of [
      'src/server/legacy-topics.ts',
      'src/server/legacy-replies.ts',
      'src/app/api/nodes/all.json/route.ts',
      'src/app/api/nodes/show.json/route.ts',
      'src/app/api/nodes/list.json/route.ts',
      'src/app/api/members/show.json/route.ts',
    ]) {
      expect(read(file), `${file} 应引用共用装配器`).toContain('legacy-assemblers');
    }
  });
});

/**
 * V13 收尾 P1-1（统一收敛）：节点 active 可见性必须覆盖**所有**旧版 / Feed 公共路径。
 *
 * 真实缺陷：此前只有 loadLegacyNodeRecords() 带 nodes.status='active'，
 * 主题查询 / ?node_name= 存在性检查 / 节点 Feed 查询都没有该条件，
 * 于是同一个 pending / hidden 节点在目录端点不可见，却仍能从
 * topics/show.json?node_name= 与节点 Feed 取到（跨接口泄漏）。
 *
 * 修复方式不是「每个文件各写一遍 eq(nodes.status,'active')」—— 那必然再次漂移，
 * 而是把唯一定义放在纯模块 `src/lib/node-visibility.ts`（V13-17）：
 * `src/server/legacy-assemblers.ts` re-export 给旧版端点，
 * `src/lib/feed-builder.ts` 直接引用（站内 `/api/feed*` 三个端点共用），
 * 共 7 条路径引用同一条件。本 describe 逐文件钉死这一契约；
 * 真实 HTTP 负向验收见 e2e/v013-legacy-api.spec.ts。
 *
 * 注意：这是**有意策略**（原站对非 active 节点的旧版 API 行为无法验证，
 * 本项目不宣称完全兼容），登记在 docs/API_SPEC.md §14.6 与兼容矩阵 §3。
 */
describe('节点 active 可见性：所有旧版 / Feed 公共路径统一收敛', () => {
  /** 唯一定义处 + re-export 处 + 5 条消费路径（含回复端点） */
  const PUBLIC_PATHS = [
    'src/lib/node-visibility.ts',
    'src/server/legacy-assemblers.ts',
    'src/server/legacy-topics.ts',
    'src/server/legacy-feed.ts',
    'src/server/legacy-replies.ts',
    'src/app/api/topics/show.json/route.ts',
    'src/app/api/nodes/[name]/feed/route.ts',
  ] as const;

  it('共用条件常量只定义一次，且恒为 active', () => {
    // 本体在纯模块（无 server-only / 无 @/db 副作用），旧版装配器只 re-export。
    // 站内 feed-builder 也要用同一条件，但它刻意注入 db ⇒ 不能反向 import 装配器。
    const pure = read('src/lib/node-visibility.ts');
    expect(pure.match(/export const PUBLIC_NODE_CONDITION/g) ?? []).toHaveLength(1);
    expect(pure).toContain("export const PUBLIC_NODE_CONDITION = eq(schema.nodes.status, 'active')");
    // ⚠️ 必须锚定行首的真实 import：纯模块的**注释**里会提到这两个模块
    //    （为了说明「为什么不能反向 import」），用 not.toContain 朴素匹配
    //    会把注释当成真实 import 而假红 —— 本仓已因此踩过多次。
    expect(pure, '纯模块不得 import server-only').not.toMatch(/^import\s+'server-only';/m);
    expect(pure, '纯模块不得 import @/db（会让单元测试凭空建连接池）').not.toMatch(
      /^import\s+[^\n]*from\s+'@\/db';/m,
    );

    const assembler = read('src/server/legacy-assemblers.ts');
    // 装配器只允许 re-export 一次，不得再自己定义一份
    expect(assembler.match(/export const PUBLIC_NODE_CONDITION/g) ?? []).toHaveLength(0);
    expect(assembler).toContain(
      "export { PUBLIC_NODE_CONDITION } from '@/lib/node-visibility';",
    );
    expect(assembler).toContain('loadNodeStars');
    expect(assembler).toContain('loadLegacyNodeRecords');
  });

  it.each(PUBLIC_PATHS)('%s 引用同一 PUBLIC_NODE_CONDITION', (file) => {
    expect(read(file), `${file} 必须引用共用节点可见性条件`).toContain(
      'PUBLIC_NODE_CONDITION',
    );
  });

  /**
   * 负向对照：把任一文件里的 `PUBLIC_NODE_CONDITION` 引用抹掉后，
   * 逐文件护栏**必须判红**。用「注入-解析」方式自证判据确实有鉴别力，
   * 而不是只在注释里声称「应该会红」—— 否则一条恒真的断言同样全绿。
   */
  it('负向对照：任一文件删掉 active 条件后护栏必须判红', () => {
    const pureModule = 'src/lib/node-visibility.ts';
    const definesCondition = (src: string): boolean =>
      /export const PUBLIC_NODE_CONDITION/.test(src);
    const reExportsCondition = (src: string): boolean =>
      /export \{ PUBLIC_NODE_CONDITION \} from '@\/lib\/node-visibility'/.test(src);
    const referencesCondition = (src: string): boolean =>
      (/from '@\/server\/legacy-assemblers'/.test(src) ||
        /from '@\/lib\/node-visibility'/.test(src)) &&
      /PUBLIC_NODE_CONDITION/.test(src);

    for (const file of PUBLIC_PATHS) {
      const src = read(file);
      const predicate =
        file === pureModule
          ? definesCondition
          : file === 'src/server/legacy-assemblers.ts'
            ? reExportsCondition
            : referencesCondition;

      // 正向：当前源码必须全部通过
      expect(predicate(src), `${file} 未通过 active 条件判据`).toBe(true);
      // 负向：抹掉常量名后，同一判据必须失败 ⇒ 真实删改会让护栏变红
      const mutated = src.replace(/PUBLIC_NODE_CONDITION/g, 'REMOVED');
      expect(
        predicate(mutated),
        `${file} 抹掉 PUBLIC_NODE_CONDITION 后仍判绿 ⇒ 护栏没有鉴别力`,
      ).toBe(false);
    }
  });

  it('消费方不得各自再写一份 nodes.status 判断（防止口径漂移）', () => {
    for (const file of PUBLIC_PATHS.slice(1)) {
      expect(read(file), `${file} 不应重复实现节点状态过滤`).not.toContain(
        'schema.nodes.status',
      );
    }
  });

  it('站内 /api/feed、atom、json 同样不得吐出非 active 节点的主题', () => {
    // 真实缺口：这三个端点共用 buildFeedEntries()，此前只过滤软删除，
    // 于是 hidden 节点下的主题仍能从站内 RSS/Atom/JSON 订阅流出去。
    const src = read('src/lib/feed-builder.ts');
    expect(src, 'feed-builder 必须引用同一节点可见性条件').toContain(
      'PUBLIC_NODE_CONDITION',
    );
    expect(src, '必须从纯模块引用，不得反向 import 旧版装配器（会拖入 @/db）').toContain(
      "from '@/lib/node-visibility'",
    );
    expect(src, '不得在 feed-builder 内重复实现节点状态过滤').not.toContain(
      'schema.nodes.status',
    );
    // 三个调用方都走 buildFeedEntries ⇒ 一处收敛即可覆盖
    for (const route of [
      'src/app/api/feed/route.ts',
      'src/app/api/feed/atom/route.ts',
      'src/app/api/feed/json/route.ts',
    ]) {
      expect(read(route), `${route} 必须走共用 buildFeedEntries`).toContain(
        'buildFeedEntries',
      );
    }
    // 负向对照：删掉条件后判据必须失败
    const hasCondition = (text: string): boolean =>
      /PUBLIC_NODE_CONDITION/.test(text) && !/schema\.nodes\.status/.test(text);
    expect(hasCondition(src)).toBe(true);
    expect(hasCondition(src.replace(/PUBLIC_NODE_CONDITION/g, 'REMOVED'))).toBe(false);
  });

  it('主题 / Feed 的原有软删除与参数语义保持不变', () => {
    const topics = read('src/server/legacy-topics.ts');
    expect(topics).toContain('innerJoin(schema.nodes');
    expect(topics).toContain('isNull(schema.topics.deletedAt)');
    expect(topics).toContain("filter.kind === 'hot'");
    const feed = read('src/server/legacy-feed.ts');
    expect(feed).toContain('.from(schema.nodes)');
    expect(feed).toContain('eq(schema.nodes.name, opts.nodeName.toLowerCase())');
    expect(feed).toContain('isNull(schema.topics.deletedAt)');
    expect(read('src/app/api/topics/show.json/route.ts')).toContain('parseLegacyId');
    expect(read('src/app/api/nodes/[name]/feed/route.ts')).toContain('feedCachedResponse');
  });

  it('回复端点同样收敛到 active 节点，且软删除三条过滤保持不变', () => {
    const src = read('src/server/legacy-replies.ts');
    // 不 join nodes 的旧实现会让 hidden 节点下主题的回复按 topic_id 泄露
    expect(src, '回复查询必须 join nodes').toContain('innerJoin(schema.nodes');
    expect(src).toContain('eq(schema.nodes.id, schema.topics.nodeId)');
    expect(src).toContain('PUBLIC_NODE_CONDITION');
    expect(src).toContain('isNull(schema.replies.deletedAt)');
    expect(src).toContain('isNull(schema.topics.deletedAt)');
    expect(src).toContain("ne(schema.topics.status, 'deleted')");
    expect(src).toContain('orderBy(asc(schema.replies.id))');
  });

  it('/feed/ALL.xml 与 /feed/all.xml 语义一致：isAll 必须大小写不敏感', () => {
    const src = read('src/app/feed/[file]/route.ts');
    const caseInsensitive = (text: string): boolean =>
      /const isAll = nodeName\.toLowerCase\(\) === 'all';/.test(text);
    expect(caseInsensitive(src), 'isAll 必须用 toLowerCase() 归一化').toBe(true);
    // 负向对照：去掉 toLowerCase() 后同一判据必须失败 ⇒ 改动会让护栏判红
    const mutated = src.replace(/nodeName\.toLowerCase\(\)/g, 'nodeName');
    expect(
      caseInsensitive(mutated),
      '去掉 toLowerCase() 后仍判绿 ⇒ 护栏没有鉴别力',
    ).toBe(false);
  });

  it('API_SPEC §14.6 登记统一收敛 + 无法验证，不得回退成分层口径', () => {
    const spec = read('docs/API_SPEC.md');
    const section = spec.slice(spec.indexOf('### 14.6'));
    expect(section.length, 'API_SPEC 缺少 §14.6').toBeGreaterThan(0);
    for (const term of ['统一', "status='active'", '无法验证', '不宣称完全兼容', '有意策略']) {
      expect(section, `§14.6 缺少口径词「${term}」`).toContain(term);
    }
    // 旧的「分层 / 历史内容保留」过宽口径不得复活
    expect(section).not.toContain('沿用历史内容保留原则');
    expect(section).not.toContain('仍可能携带非 active 节点');
  });

  it('两份文档都如实登记 Feed 节点名大小写不敏感，且不写成 404 区分大小写', () => {
    for (const file of ['docs/API_SPEC.md', 'docs/LEGACY_API_MATRIX_v0.0.13.md']) {
      const text = read(file);
      expect(text, `${file} 未登记大小写不敏感`).toContain('大小写不敏感');
      expect(text, `${file} 未披露原站行为无法确认`).toMatch(
        /原站[^\n]{0,20}(无法确认|无法验证)/,
      );
      expect(text, `${file} 仍写着「区分大小写 ⇒ 404」`).not.toContain(
        '原站节点名区分大小写；本项目沿用',
      );
    }
  });

  it('兼容矩阵把统一收敛与大小写策略登记为有意偏离', () => {
    const matrix = read('docs/LEGACY_API_MATRIX_v0.0.13.md');
    expect(matrix).toContain('统一只暴露');
    expect(matrix).toContain('PUBLIC_NODE_CONDITION');
    expect(matrix).toContain('大小写不敏感');
    expect(matrix).not.toContain('沿用历史内容保留');
  });
});

describe('软删除 / 封禁用户不得从公共接口泄露', () => {
  it('主题装配排除软删除主题', () => {
    expect(read('src/server/legacy-topics.ts')).toContain('isNull(schema.topics.deletedAt)');
  });

  it('回复装配排除软删除回复与已删除主题', () => {
    const src = read('src/server/legacy-replies.ts');
    expect(src).toContain('isNull(schema.replies.deletedAt)');
    expect(src).toContain('isNull(schema.topics.deletedAt)');
    expect(src).toContain("ne(schema.topics.status, 'deleted')");
  });

  it('封禁/停用用户的自填资料字段被装配器置空', () => {
    const src = read('src/server/legacy-assemblers.ts');
    expect(src).toContain("row.status !== 'active'");
    expect(src).toMatch(/tagline:\s*restricted \? null/);
    expect(src).toMatch(/bio:\s*restricted \? null/);
    expect(src).toMatch(/url:\s*restricted \? null/);
    expect(src).toMatch(/location:\s*restricted \? null/);
  });

  it('会员资料端点只公开 active 用户', () => {
    const src = read('src/app/api/members/show.json/route.ts');
    expect(src).toContain('PUBLIC_USER_STATUSES');
    expect(src).toContain("status: 'found'");
  });
});
