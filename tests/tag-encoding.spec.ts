import { describe, it, expect } from 'vitest';
import { safeDecode } from '../src/lib/safe-decode';
import { normalizeTag } from '../src/lib/tag-normalize';

/**
 * 标签名与 URL 编码的**纯函数层**回归（v0.0.14）
 *
 * ## 三个实测结论（写在这里是为了不再被"框架应该会…"误导）
 *
 * 1. **Next.js 的 App Router 不预解码动态段 `params`。**
 *    判别实验：删掉 `/tag/[name]` 里的解码后，`/tag/%E5%89%8D%E7%AB%AF`
 *    立刻从 200 变 404（`e2e/v014-tags.spec.ts` 的「中文标签百分号编码路径
 *    必须能命中」）。所以页面**必须**解码一次。
 * 2. **裸 `decodeURIComponent('100%')` 抛 `URIError: URI malformed`。**
 *    用户直接访问 `/tag/100%`（字面量百分号，未编码）时，若不捕获就是
 *    **整页 500**；正确行为是「查不到这个标签」⇒ 404。
 * 3. **`safeDecode` 的容错语义是「解码失败 ⇒ 原样返回」**，
 *    它**不是**"万能解码器"：喂给它的必须是**尚未解码**的原始参数。
 *    对已解码的值再调一次就是二次解码（`%2525` → `%25` → `%`，越解越错）。
 *
 * 本文件把这些语义钉在纯函数层：不需要数据库、不需要浏览器，
 * 因此可以作为 `/tag/[name]`、`/go/[name]` 这类路由的第一道防线。
 */

describe('safeDecode：百分号编码往返（中文 / 日文 / 韩文 / 全角）', () => {
  /** 逐个断言「编码 → 解码」能还原（这正是页面侧必须做的事） */
  function expectRoundTrip(tag: string) {
    const encoded = encodeURIComponent(tag);
    // 前提：编码确实变了（否则这条断言没有意义）
    expect(encoded, `${tag} 的编码结果应与原文不同`).not.toBe(tag);
    expect(safeDecode(encoded), `${tag} 经 encodeURIComponent → safeDecode 必须还原`).toBe(tag);
  }

  it('中文标签', () => {
    expectRoundTrip('前端');
    expectRoundTrip('中文标签测试');
    // 明确钉住表达式本身：这是 e2e 判别实验里用的那一对值
    expect(encodeURIComponent('前端')).toBe('%E5%89%8D%E7%AB%AF');
    expect(safeDecode('%E5%89%8D%E7%AB%AF')).toBe('前端');
  });

  it('日文（平假名 / 片假名）与韩文', () => {
    expectRoundTrip('にほんご');
    expectRoundTrip('プログラミング');
    expectRoundTrip('한국어');
  });

  it('全角字符与全角标点（编码后能还原；是否被接纳由 normalizeTag 决定）', () => {
    expectRoundTrip('全角ＡＢＣ');
    expectRoundTrip('测试，标签');
  });

  it('现代码点（emoji / 四字节字符）不会被解码截断', () => {
    // `decodeURIComponent` 处理的是 UTF-8 字节序列，四字节字符（emoji）
    // 若被按字符切开会变成乱码 —— 这里确认往返完整。
    expectRoundTrip('🔥');
    expectRoundTrip('前端🔥');
  });
});

describe('safeDecode：字面量 % 与畸形编码（不抛异常、原样返回）', () => {
  it('字面量 `%`（`/tag/100%` 的真实入参）不抛异常', () => {
    expect(() => safeDecode('100%')).not.toThrow();
    expect(safeDecode('100%')).toBe('100%');
    // 负向对照：证明这确实是一条"必须容错"的路径
    expect(() => decodeURIComponent('100%')).toThrow();
  });

  it('`%25`（`%` 的编码）解码为 `%`，且不会连锁解码', () => {
    // `/tag/100%25` ⇒ Next 给到页面的原始值就是 `100%25` ⇒ 解一次得到 `100%`
    expect(safeDecode('100%25')).toBe('100%');
    // ⚠️ 再解一次仍是 `100%`（第二次是无效编码 ⇒ 原样返回），
    //    但 `%2525` 会越解越短 —— 所以页面**只能解一次**。见下方专门用例。
    expect(safeDecode(safeDecode('100%25'))).toBe('100%');
  });

  it('截断的多字节序列（`%E4%B8`）不抛异常、原样返回', () => {
    // `%E4%B8` 是「中」(E4 B8 AD) 的前两个字节 —— 典型的手工拼 URL 事故
    expect(() => safeDecode('%E4%B8')).not.toThrow();
    expect(safeDecode('%E4%B8')).toBe('%E4%B8');
    expect(() => decodeURIComponent('%E4%B8')).toThrow();
  });

  it('其它畸形编码同样原样返回', () => {
    for (const bad of ['%', '%%', '%ZZ', '%E4%B8%', 'a%zzb', '%C3%28']) {
      expect(() => safeDecode(bad), `${bad} 不应抛异常`).not.toThrow();
      expect(safeDecode(bad), `${bad} 应原样返回`).toBe(bad);
    }
  });

  it('二次解码会破坏数据（`%2525` ⇒ `%25` ⇒ `%`）—— 页面只能解一次', () => {
    const once = safeDecode('%2525');
    expect(once, '一次解码得到 `%25`').toBe('%25');
    const twice = safeDecode(once);
    expect(twice, '二次解码得到 `%`：这就是"越解越错"').toBe('%');
    expect(twice).not.toBe(once);
  });
});

describe('标签名与路径分隔符：`%2F` 不得变成路由分隔符', () => {
  it('safeDecode(`%2F`) === `/`（解码本身是忠实的）', () => {
    // 这条**不是**说页面可以直接把解码结果拼进路由，而是说：
    // 解码函数本身不该"擅自吞掉"斜杠 —— 是否安全由**使用方式**决定。
    expect(safeDecode('%2F')).toBe('/');
    expect(safeDecode('a%2Fb')).toBe('a/b');
  });

  it('`safeDecode` 只用于**已解码后**的参数，不用于拼接路由', () => {
    // 页面侧的约定（`src/app/tag/[name]/page.tsx`）：
    //   ① 参数来自 `params.name`（原始、未解码）→ 必须先 `safeDecode`；
    //   ② 生成链接时反过来 `encodeURIComponent(tagName)`。
    // 若反过来（先 decode 再拼进路径），`%2F` 会变成路径分隔符 ⇒ 路由错配。
    const tagName = 'a/b';
    const href = `/tag/${encodeURIComponent(tagName)}`;
    expect(href, '拼路由必须重新编码，不能把解码结果直接拼进去').toBe('/tag/a%2Fb');
    expect(href.split('/').length, '编码后的路径段数不应因为它含斜杠而改变').toBe(3);
    const rawInUrl = '/tag/' + tagName;
    expect(rawInUrl.split('/').length, '若不编码，斜杠会多切出一段 —— 这正是要避免的').toBe(4);
  });

  it('标签名里的 `/` 在写入前就被 normalizeTag 剔除（双保险）', () => {
    // 即使有人绕过页面直接 POST `{"tags":["a/b"]}`，落库的值也不含斜杠：
    // `/` 不在允许字符集里，被剔除后仍是合法标签。
    expect(normalizeTag('a/b')).toBe('ab');
    expect(normalizeTag('/')).toBeNull();
    // 剔除后为空的输入一律丢弃（不写空标签、不报错）
    expect(normalizeTag('///')).toBeNull();
  });
});

describe('normalizeTag：跨语言字符集的真实边界（实测行为，不是期望）', () => {
  it('中日韩文字与字母数字被接纳', () => {
    expect(normalizeTag('前端')).toBe('前端');
    expect(normalizeTag('にほんご')).toBe('にほんご');
    expect(normalizeTag('한국어')).toBe('한국어');
    expect(normalizeTag('next.js')).toBe('next.js');
  });

  it('全角拉丁字母会被剔除（保留集只含半角 a-z）—— 属已知限制', () => {
    // 这是**实测真实行为**：`\uFF21-\uFF5A`（Ａ-Ｚ）不在允许字符集里。
    // 记录下来而不是假装它被"规范化"成半角 —— 若将来要对全角做归一化，
    // 必须改实现并同步改这条断言（而不是让测试悄悄变绿）。
    expect(normalizeTag('ＡＢＣ')).toBeNull();
    expect(normalizeTag('测试，标签')).toBe('测试标签'); // 全角标点被剔除，汉字保留
  });

  it('全角空格折叠与普通空白一致（都变成连字符）', () => {
    // `\s` 在 JS 里包含全角空格 U+3000
    expect(normalizeTag('a　b')).toBe('a-b');
  });
});
