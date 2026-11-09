import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Parser } from 'htmlparser2';
import {
  atomIdOf,
  atomTime,
  buildLegacyAtom,
  buildLegacyJsonFeed,
  cdata,
  escapeXmlText,
  jsonFeedTime,
  stripInvalidXmlChars,
  type LegacyFeedChannel,
} from '../../src/lib/legacy-feed-format';
import {
  feedCachedResponse,
  feedEtag,
  ifNoneMatchHits,
  parseIfNoneMatch,
} from '../../src/lib/feed-cache';

/**
 * v0.0.13（V13-06 / QA P1-4）：Feed **可解析性 / 转义 / 缓存**护栏
 *
 * 任务书要求「Atom XML 可被真实 XML 解析器解析」，而不只是 HTTP 200。
 *
 * ⚠️ 措辞勘误（独立 QA 复核后修正）：`htmlparser2` 在 `xmlMode: true` 下是
 * **宽松解析器** —— 实测喂入 `<feed><entry><title>x</entry></feed>` 这类
 * 错配标签时 `onerror` 计数为 0，它会自动「补」出 implied 关闭标签。
 * 所以本文件此前写的「用真实 XML 解析器验证」是**过强断言**：
 * 它只提取了标签序列，检不出任何结构缺陷。
 *
 * 修法：`parseXml()` 先跑 `xmlWellFormedErrors()` —— 一个独立的
 * **严格扫描器**（跳过 CDATA / 注释 / PI / 声明，用栈配对普通标签，
 * 并检测 CDATA 之外裸 `]]>`），有错误就抛。实测对照：
 *   良好 / 自闭合 / `]]>` 拆分 ⇒ 0 错误；
 *   标签错配 / 未闭合 / CDATA 提前闭合 / CDATA 未闭合 ⇒ 均被抓到。
 * 新增负向对照测试证明这些坏样本确实会让护栏判红。
 * 浏览器侧**真正严格**的 `DOMParser`（带 parsererror 判定）验证放在
 * `e2e/v013-feed-reader.spec.ts` —— 两处职责不同，不得互相冒充。
 *
 * 重点覆盖两类「HTTP 200 但阅读器订阅失败」的缺陷：
 *   1. 正文里的 `]]>` 提前闭合 CDATA ⇒ XML 结构损坏
 *   2. 正文夹带 XML 1.0 非法控制字符 ⇒ 严格解析器直接报错
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/**
 * 严格 XML well-formedness 扫描器（不依赖 htmlparser2 的宽松容错）。
 *
 * 为什么不用 `onclosetag` 的 `isImplied`：实测 htmlparser2 对**自闭合**
 * `<link/>` 也发 implied close，对**错配标签**则把所有 close 都变成 implied
 * ⇒ 栈式判据既会把好文档判红，又会把坏文档判绿。完全不可用。
 */
export function xmlWellFormedErrors(xml: string): string[] {
  const stack: string[] = [];
  const errors: string[] = [];
  let i = 0;
  while (i < xml.length) {
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) { errors.push('CDATA 未闭合'); break; }
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) { errors.push('注释未闭合'); break; }
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) { errors.push('处理指令未闭合'); break; }
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!', i)) {
      const end = xml.indexOf('>', i + 2);
      if (end < 0) { errors.push('声明未闭合'); break; }
      i = end + 1;
      continue;
    }
    if (xml[i] === '<') {
      const end = xml.indexOf('>', i);
      if (end < 0) { errors.push('标签未闭合'); break; }
      const raw = xml.slice(i + 1, end);
      if (raw.startsWith('/')) {
        const name = raw.slice(1).trim();
        const expected = stack.pop();
        if (expected !== name) errors.push(`期望 </${expected ?? '(空)'}>，实际 </${name}>`);
      } else if (!raw.endsWith('/')) {
        const name = raw.match(/^([^\s/>]+)/)?.[1];
        if (name) stack.push(name);
      }
      i = end + 1;
      continue;
    }
    if (xml.startsWith(']]>', i)) {
      errors.push('CDATA 之外出现裸 ]]>（CDATA 被提前闭合）');
      i += 3;
      continue;
    }
    i++;
  }
  if (stack.length > 0) errors.push(`未闭合标签：${stack.join(', ')}`);
  return errors;
}

/** 严格校验 + 用 htmlparser2 提取标签/文本（结构已由上面的扫描器保证） */
function parseXml(xml: string): { tags: string[]; text: string } {
  const errors = xmlWellFormedErrors(xml);
  if (errors.length > 0) throw new Error(`XML 结构破损：${errors.join('；')}`);
  const tags: string[] = [];
  const texts: string[] = [];
  const parser = new Parser(
    {
      xmlMode: true,
      onopentag: (name: string) => tags.push(name),
      ontext: (t: string) => texts.push(t),
    },
    { decodeEntities: true },
  );
  parser.write(xml);
  parser.end();
  return { tags, text: texts.join('') };
}

function channel(overrides: Partial<LegacyFeedChannel> = {}): LegacyFeedChannel {
  return {
    title: '节点 & <订阅> "中文"',
    subtitle: 'way to explore',
    homePageUrl: 'https://example.test/go/python',
    selfLinkAtom: 'https://example.test/feed/python.xml',
    selfLinkJson: 'https://example.test/feed/python.json',
    iconUrl: 'https://example.test/icon.svg',
    logoUrl: 'https://example.test/logo.svg',
    updatedAt: new Date('2026-11-09T02:03:04Z'),
    entries: [
      {
        topicId: 42,
        title: '主题 <一> & 中文',
        link: 'https://example.test/t/42#reply3',
        atomId: 'tag:example.test,2026-11-09:/t/42',
        jsonId: 'https://example.test/t/42',
        contentHtml: '<p>你好 中文 &amp; 特殊字符 ]]> 结尾</p>',
        publishedAt: new Date('2026-11-09T01:02:03Z'),
        updatedAt: new Date('2026-11-09T02:03:04Z'),
        authorName: '作者 & <A>',
        authorUrl: 'https://example.test/member/a',
        authorAvatarLarge: 'https://example.test/a.png',
        repliesCount: 3,
      },
    ],
    ...overrides,
  };
}

describe('XML 转义与 CDATA 安全', () => {
  it('escapeXmlText 转义五类字符', () => {
    expect(escapeXmlText(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });

  it('cdata 把 ]]> 拆成两段，避免提前闭合', () => {
    expect(cdata('a]]>b')).toBe('a]]]]><![CDATA[>b');
    expect(cdata('plain')).toBe('plain');
  });

  it('stripInvalidXmlChars 去掉控制字符、保留中文与合法空白', () => {
    expect(stripInvalidXmlChars('中\u0001文\t\n\r')).toBe('中文\t\n\r');
  });

  it('Atom 可被真实 XML 解析器解析：feed/entry 数量正确、文本保留中文', () => {
    const xml = buildLegacyAtom(channel());
    const { tags, text } = parseXml(xml);
    expect(tags.filter((t) => t === 'feed')).toHaveLength(1);
    expect(tags.filter((t) => t === 'entry')).toHaveLength(1);
    expect(tags.filter((t) => t === 'content')).toHaveLength(1);
    // 解析器用于验证**结构**；CDATA 是原始文本段，htmlparser2 不把它交给
    // ontext，因此正文本身用原文断言（CDATA 里就是字面文本，不需解码）。
    expect(text).toContain('中文');
    expect(xml).toContain('你好 中文');
    expect(xml).toContain('特殊字符 ]]]]><![CDATA[> 结尾');
    // `]]>` 已被拆成两段 CDATA，没有提前闭合
    expect(xml).not.toContain('特殊字符 ]]></content>');
  });

  it('正文夹带非法控制字符时仍能解析', () => {
    const c = channel();
    c.entries[0].contentHtml = '<p>控制\u0001字符 中文</p>';
    const xml = buildLegacyAtom(c);
    expect(xml).not.toContain('\u0001');
    const { tags } = parseXml(xml);
    expect(tags.filter((t) => t === 'entry')).toHaveLength(1);
  });

  it('feed 级元素顺序是契约（title→subtitle→icon→logo→link→link→id→updated）', () => {
    const xml = buildLegacyAtom(channel());
    const head = xml.slice(xml.indexOf('<feed'), xml.indexOf('<entry>'));
    const order = ['<title>', '<subtitle>', '<icon>', '<logo>',
      '<link rel="alternate"', '<link rel="self"', '<id>', '<updated>'];
    let cursor = 0;
    for (const tag of order) {
      const at = head.indexOf(tag, cursor);
      expect(at, `${tag} 缺失或顺序不对`).toBeGreaterThanOrEqual(cursor);
      cursor = at + tag.length;
    }
  });
});

describe('格式化契约（时间 / id / JSON Feed 1.0）', () => {
  it('Atom 秒级 Z，JSON Feed +00:00', () => {
    const d = new Date('2026-11-09T02:03:04.567Z');
    expect(atomTime(d)).toBe('2026-11-09T02:03:04Z');
    expect(jsonFeedTime(d)).toBe('2026-11-09T02:03:04+00:00');
  });

  it('Atom id 形如 tag:host,YYYY-MM-DD:/t/{id}', () => {
    expect(atomIdOf('https://example.test', 42, new Date('2026-11-09T01:02:03Z')))
      .toBe('tag:example.test,2026-11-09:/t/42');
  });

  it('JSON Feed 用 1.0（author{}，无 authors[] / content_text）', () => {
    const feed = JSON.parse(buildLegacyJsonFeed(channel()));
    expect(feed.version).toBe('https://jsonfeed.org/version/1');
    expect(feed.items[0].author).toBeTruthy();
    expect(feed.items[0].authors).toBeUndefined();
    expect(feed.items[0].content_text).toBeUndefined();
    expect(feed.items[0].date_published).toMatch(/\+00:00$/);
    expect(feed.items[0].id).toBe('https://example.test/t/42');
    expect(feed.items[0].url).toContain('#reply3');
  });
});

describe('ETag / 304 条件请求', () => {
  it('feedEtag 是确定性 SHA-256 强校验（带双引号）', () => {
    expect(feedEtag('abc')).toBe(feedEtag('abc'));
    expect(feedEtag('abc')).not.toBe(feedEtag('abd'));
    expect(feedEtag('abc')).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it('If-None-Match 支持精确 / 列表 / W/ 弱前缀 / 通配符', () => {
    const tag = feedEtag('abc');
    expect(ifNoneMatchHits(tag, tag)).toBe(true);
    expect(ifNoneMatchHits(`"other", ${tag}`, tag)).toBe(true);
    expect(ifNoneMatchHits(`W/${tag}`, tag)).toBe(true);
    expect(ifNoneMatchHits('*', tag)).toBe(true);
    expect(ifNoneMatchHits('"other"', tag)).toBe(false);
    expect(ifNoneMatchHits(null, tag)).toBe(false);
    expect(parseIfNoneMatch('W/"a", "b"').tags).toEqual(['"a"', '"b"']);
  });

  it('命中 ⇒ 304 且 body 为空；未命中 ⇒ 200 且带 ETag', async () => {
    const headers = { 'Content-Type': 'application/atom+xml;charset=UTF-8' };
    const body = buildLegacyAtom(channel());
    const first = feedCachedResponse(new Request('https://x.test/feed/a.xml'), body, headers);
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = feedCachedResponse(
      new Request('https://x.test/feed/a.xml', { headers: { 'If-None-Match': etag! } }),
      body,
      headers,
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers.get('etag')).toBe(etag);
  });
});

describe('Markdown 正文不形成恶意 HTML（结构断言）', () => {
  it('Feed / 回复正文都走站内 renderMarkdown，不直接拼接', () => {
    for (const file of ['src/server/legacy-feed.ts', 'src/server/legacy-replies.ts']) {
      expect(read(file), `${file} 必须经过清洗`).toContain('renderMarkdown');
    }
  });

  it('清洗器使用 sanitize-html 且协议白名单不含 javascript/data', () => {
    const src = read('src/lib/markdown.ts');
    expect(src).toContain("from 'sanitize-html'");
    expect(src).toContain('ALLOWED_SCHEMES');
    expect(src).not.toContain("'data:image/svg+xml");
    expect(src).not.toContain("'javascript'");
  });

  it('所有 Feed 路由都接入 ETag 条件请求', () => {
    for (const file of [
      'src/app/feed/[file]/route.ts',
      'src/app/api/feed/route.ts',
      'src/app/api/feed/atom/route.ts',
      'src/app/api/feed/json/route.ts',
      'src/app/api/nodes/[name]/feed/route.ts',
    ]) {
      expect(read(file), `${file} 应带 ETag`).toContain('feedCachedResponse');
    }
  });
});

/**
 * QA P1-4 负向对照：证明本文件的解析护栏**真的能检出缺陷**。
 *
 * 修复前 `parseXml()` 只收集标签序列，喂入任何破损 XML 都不会抛错，
 * 于是「Atom 可被真实 XML 解析器解析」是一句无法被证伪的断言。
 * 下面逐条注入真实坏样本，要求严格扫描器必须报错 —— 若哪天护栏
 * 被改回宽松解析器，这些用例会立刻判红。
 */
describe('负向对照：严格扫描器必须能检出破损 XML', () => {
  const good = [
    ['基本嵌套', '<feed><entry><title>x</title></entry></feed>'],
    ['自闭合标签', '<feed><link href="x"/><entry><title>x</title></entry></feed>'],
    ['正确拆分的 ]]>', '<feed><content><![CDATA[a]]]]><![CDATA[>b]]></content></feed>'],
    ['XML 声明 + 注释', '<?xml version="1.0" encoding="UTF-8"?><!-- c --><feed><title>x</title></feed>'],
  ] as const;

  const broken = [
    ['标签错配', '<feed><entry><title>x</entry></feed>'],
    ['标签未闭合', '<feed><entry>'],
    ['CDATA 提前闭合', '<feed><content><![CDATA[a]]>b]]></content></feed>'],
    ['CDATA 未闭合', '<feed><content><![CDATA[abc</content></feed>'],
    ['注释未闭合', '<feed><!-- oops </feed>'],
  ] as const;

  for (const [label, xml] of good) {
    it(`良好文档不得误报：${label}`, () => {
      expect(xmlWellFormedErrors(xml), label).toEqual([]);
      expect(() => parseXml(xml), label).not.toThrow();
    });
  }

  for (const [label, xml] of broken) {
    it(`破损文档必须被抓到：${label}`, () => {
      expect(xmlWellFormedErrors(xml).length, label).toBeGreaterThan(0);
      expect(() => parseXml(xml), label).toThrow(/XML 结构破损/);
    });
  }

  it('buildLegacyAtom 产出的真实 Atom 必须通过严格扫描（正样本）', () => {
    const xml = buildLegacyAtom(channel());
    expect(xmlWellFormedErrors(xml)).toEqual([]);
    expect(() => parseXml(xml)).not.toThrow();
  });

  it('若绕过 cdata() 直接拼接 ]]>，严格扫描器必须判红（证明 cdata() 不是摆设）', () => {
    const raw = '<feed><content><![CDATA[' + 'a]]>b' + ']]></content></feed>';
    expect(xmlWellFormedErrors(raw).length).toBeGreaterThan(0);
    const safe = '<feed><content><![CDATA[' + cdata('a]]>b') + ']]></content></feed>';
    expect(xmlWellFormedErrors(safe)).toEqual([]);
  });
});

describe('XML 1.0 非法字符：孤立代理项也不得漏', () => {
  it('stripInvalidXmlChars 剥离孤立高/低代理项，保留合法 emoji 代理对', () => {
    expect(stripInvalidXmlChars('a\u0001b')).toBe('ab');
    expect(stripInvalidXmlChars('a\uD800b')).toBe('ab');
    expect(stripInvalidXmlChars('a\uDC00b')).toBe('ab');
    expect(stripInvalidXmlChars('中文')).toBe('中文');
    expect(stripInvalidXmlChars('emoji 😀')).toBe('emoji 😀');
  });

  it('escapeXmlText / cdata 对孤立代理项同样安全', () => {
    expect(escapeXmlText('<a>\uD800</a>')).toBe('&lt;a&gt;&lt;/a&gt;');
    expect(cdata('a\uDC00]]>b')).not.toContain('\uDC00');
    expect(xmlWellFormedErrors('<feed><c><![CDATA[' + cdata('a\uDC00]]>b') + ']]></c></feed>')).toEqual([]);
  });

  it('feed-builder 的清洗器也覆盖孤立代理项', () => {
    expect(read('src/lib/feed-builder.ts')).toContain('\\uD800-\\uDBFF');
  });
});

describe('旧版端点的限流三元组响应头（P2-7 / P2-8）', () => {
  it('legacy-http.ts 抽出共用 legacyRateLimitHeaders，JSON 端点复用它', () => {
    const http = read('src/lib/legacy-http.ts');
    expect(http).toContain('export function legacyRateLimitHeaders');
    expect(http).toContain('...legacyRateLimitHeaders(rl)');
    for (const key of ['x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset']) {
      expect(http).toContain(key);
    }
  });

  it('nodes/list.json 的 400 响应也回写配额（body 仍照抄原站极简 HTML）', () => {
    const route = read('src/app/api/nodes/list.json/route.ts');
    expect(route).toContain('legacyBadRequest(rl)');
    const http = read('src/lib/legacy-http.ts');
    expect(http).toContain('legacyBadRequest(rl?: LegacyRateLimit)');
    expect(http).toContain('...(rl ? legacyRateLimitHeaders(rl) : {})');
    expect(http).toContain('<html><title>400: Bad Request</title>');
  });

  it('原站路径 Feed 的 200 / 404 / 304 都带三元组', () => {
    const route = read('src/app/feed/[file]/route.ts');
    expect(route).toContain('legacyRateLimitHeaders');
    // 出现 3 次：两处 404 分支 + json 200 + atom 200（至少 4 处）
    const occurrences = (route.match(/legacyRateLimitHeaders\(rl\)/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4);
    // feedCachedResponse 把 headers 原样带到 200 与 304
    expect(read('src/lib/feed-cache.ts')).toContain('headers');
  });

  it('Feed 节点名大小写口径：代码是 /i + toLowerCase，注释不得写成 404', () => {
    const route = read('src/app/feed/[file]/route.ts');
    expect(route).toMatch(/\/\^.*\(xml\|json\)\$\/i/);
    expect(route).not.toContain('原站节点名区分大小写');
    expect(route).toContain('大小写不敏感');
  });
});
