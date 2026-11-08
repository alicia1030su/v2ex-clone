import { describe, it, expect } from 'vitest';
import {
  legacyNotFound,
  parseLegacyId,
  toLegacyMember,
  toLegacyNode,
  toLegacyTopic,
  unixSeconds,
  type LegacyMemberInput,
  type LegacyNodeInput,
} from '../../src/lib/legacy-topic-api';

/**
 * v0.0.13（V10-23）：旧版 V2EX JSON API 的**契约护栏**
 *
 * ## 为什么这层护栏必须存在
 *
 * `/api/topics/show.json` 是给**第三方客户端**用的兼容端点。它的价值
 * 全部押在「字段名 / 类型 / 空值语义与原站一致」上 —— 一旦有人把
 * `created` 从 Unix 秒改成 ISO 字符串、把 `deleted` 从 0/1 改成布尔、
 * 或把零回复时的 `last_reply_by` 从 `''` 改成 `null`，**编译能过、
 * 站内页面毫无变化、CI 大部分用例也不红**，但所有外部客户端会静默解析失败。
 *
 * 本文件把「实测得到的原站契约」钉死成断言。所有期望值都来自
 * 2026-11-08 对原站的真实抓取（记录见 `src/lib/legacy-topic-api.ts` 文件头），
 * 不是凭印象写的。
 */

const ORIGIN = 'https://example.test';

function memberInput(overrides: Partial<LegacyMemberInput> = {}): LegacyMemberInput {
  return {
    id: 7,
    username: 'lisi',
    tagline: null,
    bio: null,
    url: null,
    location: null,
    createdAt: new Date('2024-01-02T03:04:05Z'),
    lastActiveAt: new Date('2026-11-08T00:00:00Z'),
    avatars: {
      mini: 'data:image/svg+xml;base64,AAA',
      normal: 'data:image/svg+xml;base64,BBB',
      large: 'data:image/svg+xml;base64,CCC',
      xlarge: 'data:image/svg+xml;base64,DDD',
      xxlarge: 'data:image/svg+xml;base64,EEE',
      xxxlarge: 'data:image/svg+xml;base64,FFF',
    },
    ...overrides,
  };
}

function nodeInput(overrides: Partial<LegacyNodeInput> = {}): LegacyNodeInput {
  return {
    id: 3,
    name: 'programmer',
    title: '程序员',
    topicsCount: 42,
    stars: 5,
    founderId: 1,
    parentNodeName: null,
    avatars: {
      mini: 'data:image/svg+xml;base64,GGG',
      normal: 'data:image/svg+xml;base64,HHH',
      large: 'data:image/svg+xml;base64,III',
    },
    ...overrides,
  };
}

describe('旧版 API · 顶层字段集与原站逐字一致', () => {
  it('主题对象的键集合 = 实测的 13 个键（多一个少一个都算破坏兼容）', () => {
    const topic = toLegacyTopic(
      {
        id: 1,
        title: 't',
        content: 'raw markdown',
        contentHtml: '<p>raw markdown</p>',
        repliesCount: 3,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        editedAt: null,
        lastReplyAt: new Date('2026-01-02T00:00:00Z'),
        deleted: false,
        lastReplyBy: 'wangwu',
        member: memberInput(),
        node: nodeInput(),
      },
      ORIGIN,
    );

    expect(Object.keys(topic).sort()).toEqual(
      [
        'content',
        'content_rendered',
        'created',
        'deleted',
        'id',
        'last_modified',
        'last_reply_by',
        'last_touched',
        'member',
        'node',
        'replies',
        'title',
        'url',
      ].sort(),
    );
  });

  it('时间字段是 Unix 秒整数（不是 ISO 字符串、不是毫秒）', () => {
    const topic = toLegacyTopic(
      {
        id: 1,
        title: 't',
        content: '',
        contentHtml: '',
        repliesCount: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        editedAt: new Date('2026-01-03T00:00:00Z'),
        lastReplyAt: new Date('2026-01-02T00:00:00Z'),
        deleted: false,
        lastReplyBy: null,
        member: memberInput(),
        node: nodeInput(),
      },
      ORIGIN,
    );

    expect(topic.created).toBe(1767225600);
    expect(topic.last_touched).toBe(1767312000);
    // 有编辑 ⇒ last_modified 取编辑时间（原站语义）；2026-01-03T00:00:00Z
    expect(topic.last_modified).toBe(1767398400);
    for (const key of ['created', 'last_modified', 'last_touched'] as const) {
      expect(Number.isInteger(topic[key]), `${key} 必须是整数秒`).toBe(true);
    }
  });

  it('未编辑时 last_modified 等于 created（原站实测：两值相同）', () => {
    const created = new Date('2026-02-02T02:02:02Z');
    const topic = toLegacyTopic(
      {
        id: 2,
        title: 't',
        content: '',
        contentHtml: '',
        repliesCount: 0,
        createdAt: created,
        editedAt: null,
        lastReplyAt: created,
        deleted: false,
        lastReplyBy: null,
        member: memberInput(),
        node: nodeInput(),
      },
      ORIGIN,
    );
    expect(topic.last_modified).toBe(topic.created);
  });

  it('deleted 是整数 0/1，不是布尔（原站实测为 int）', () => {
    const base = {
      id: 1,
      title: 't',
      content: '',
      contentHtml: '',
      repliesCount: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      editedAt: null,
      lastReplyAt: new Date('2026-01-01T00:00:00Z'),
      lastReplyBy: null,
      member: memberInput(),
      node: nodeInput(),
    };
    expect(toLegacyTopic({ ...base, deleted: false }, ORIGIN).deleted).toBe(0);
    expect(toLegacyTopic({ ...base, deleted: true }, ORIGIN).deleted).toBe(1);
    expect(typeof toLegacyTopic({ ...base, deleted: true }, ORIGIN).deleted).toBe('number');
  });

  it('零回复时 last_reply_by 是空字符串（原站实测），不是 null', () => {
    const topic = toLegacyTopic(
      {
        id: 3,
        title: 't',
        content: '',
        contentHtml: '',
        repliesCount: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        editedAt: null,
        lastReplyAt: new Date('2026-01-01T00:00:00Z'),
        deleted: false,
        lastReplyBy: null,
        member: memberInput(),
        node: nodeInput(),
      },
      ORIGIN,
    );
    expect(topic.last_reply_by).toBe('');
    expect(typeof topic.last_reply_by).toBe('string');
  });

  it('url 是绝对地址且指向主题详情', () => {
    const topic = toLegacyTopic(
      {
        id: 1253638,
        title: 't',
        content: '',
        contentHtml: '',
        repliesCount: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        editedAt: null,
        lastReplyAt: new Date('2026-01-01T00:00:00Z'),
        deleted: false,
        lastReplyBy: null,
        member: memberInput(),
        node: nodeInput(),
      },
      ORIGIN,
    );
    expect(topic.url).toBe('https://example.test/t/1253638');
    expect(topic.member.url).toBe('https://example.test/member/lisi');
    expect(topic.node.url).toBe('https://example.test/go/programmer');
  });
});

describe('旧版 API · member 与 node 子结构', () => {
  it('member 的 19 个键与原站一致，六个头像尺寸都在', () => {
    const member = toLegacyMember(memberInput(), ORIGIN);
    expect(Object.keys(member).sort()).toEqual(
      [
        'id',
        'username',
        'url',
        'tagline',
        'bio',
        'created',
        'last_modified',
        'location',
        'website',
        'twitter',
        'github',
        'psn',
        'btc',
        'pro',
        'avatar_mini',
        'avatar_normal',
        'avatar_large',
        'avatar_xlarge',
        'avatar_xxlarge',
        'avatar_xxxlarge',
      ].sort(),
    );
    // 未建模的社交字段必须显式为 null（原站未填时也是 null）
    expect(member.twitter).toBeNull();
    expect(member.github).toBeNull();
    expect(member.psn).toBeNull();
    expect(member.btc).toBeNull();
    // 无 Pro 体系 ⇒ 0（原站非 Pro 也为 0）
    expect(member.pro).toBe(0);
  });

  it('node 的 16 个键与原站一致；parent 为空时 root=true、parent_node_name 为空串', () => {
    const node = toLegacyNode(nodeInput({ parentNodeName: null }), ORIGIN);
    expect(Object.keys(node).sort()).toEqual(
      [
        'id',
        'name',
        'url',
        'title',
        'title_alternative',
        'topics',
        'stars',
        'header',
        'footer',
        'founder_id',
        'root',
        'parent_node_name',
        'aliases',
        'avatar_mini',
        'avatar_normal',
        'avatar_large',
      ].sort(),
    );
    expect(node.root).toBe(true);
    expect(node.parent_node_name).toBe('');
    expect(node.aliases).toEqual([]);
    expect(node.header).toBe('');
    expect(node.footer).toBe('');
  });

  it('有父节点时 root=false 且 parent_node_name 是父节点名（原站 babel → v2ex）', () => {
    const node = toLegacyNode(nodeInput({ parentNodeName: 'v2ex' }), ORIGIN);
    expect(node.root).toBe(false);
    expect(node.parent_node_name).toBe('v2ex');
  });
});

describe('旧版 API · 查询语义（全部来自原站实测）', () => {
  it('parseLegacyId：同名参数取**最后**一个（原站 ?id=1&id=2&id=3 ⇒ 3）', () => {
    expect(parseLegacyId(['1', '2', '3'])).toBe(3);
    expect(parseLegacyId(['42'])).toBe(42);
  });

  it('parseLegacyId：非法值返回 null（原站 ?id=abc / ?id=0 ⇒ 404）', () => {
    expect(parseLegacyId([])).toBeNull();
    expect(parseLegacyId(['0'])).toBeNull();
    expect(parseLegacyId(['abc'])).toBeNull();
    expect(parseLegacyId(['-1'])).toBeNull();
    expect(parseLegacyId(['1', 'abc'])).toBeNull(); // 最后一个非法 ⇒ 整体非法
    expect(parseLegacyId(['1.5'])).toBeNull();
  });

  it('404 错误体形状与原站一致（status/message/rate_limit 三段）', () => {
    const body = legacyNotFound(5, 600, 1794154067);
    expect(body).toEqual({
      status: 'error',
      message: 'Object Not Found',
      rate_limit: { used: 5, quota: 600, reset_at: 1794154067 },
    });
  });

  it('unixSeconds：非法/空值退化为 0，不产生 NaN', () => {
    expect(unixSeconds(null)).toBe(0);
    expect(unixSeconds(undefined)).toBe(0);
    expect(unixSeconds(new Date('1970-01-01T00:00:10Z'))).toBe(10);
    expect(Number.isNaN(unixSeconds('not-a-date'))).toBe(false);
  });
});
