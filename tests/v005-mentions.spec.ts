import { describe, it, expect } from 'vitest';
import {
  extractMentions,
  buildMentionMessage,
  MAX_MENTIONS_PER_CONTENT,
} from '../src/lib/mentions';

/**
 * v0.0.5 @ 提及 —— 单元测试
 *
 * 覆盖 `src/lib/mentions.ts`（被 `src/app/api/replies/route.ts` 使用）。
 */

describe('v0.0.5 @ 提及 · extractMentions', () => {
  it('提取单个提及', () => {
    expect(extractMentions('你好 @alice 请看一下')).toEqual(['alice']);
  });

  it('提取多个提及', () => {
    expect(extractMentions('@alice @bob 一起看看')).toEqual(['alice', 'bob']);
  });

  it('去重（同一条内容里 @ 同一用户多次只通知一次）', () => {
    expect(extractMentions('@alice 你好 @alice 再见')).toEqual(['alice']);
  });

  it('不把邮箱地址当成提及', () => {
    // `email@example.com` 里的 `example` 前面的字符是字母 ⇒ 不是提及
    expect(extractMentions('联系 email@example.com 获取详情')).toEqual([]);
  });

  it('不把行内的 @ 单词当成提及（需要单词边界）', () => {
    // `@` 前是字母 ⇒ 不是提及的开始
    expect(extractMentions('foo@bar 不是提及')).toEqual([]);
  });

  it('行首的提及被正确提取', () => {
    expect(extractMentions('@alice 开头的句子')).toEqual(['alice']);
  });

  it('标点后的提及被正确提取', () => {
    expect(extractMentions('你好，@alice！')).toEqual(['alice']);
  });

  it('括号内的提及被正确提取', () => {
    expect(extractMentions('（@alice）')).toEqual(['alice']);
  });

  it('用户名长度不足 2 位不提取', () => {
    expect(extractMentions('@a 太短')).toEqual([]);
  });

  it('用户名长度超过 32 位不提取', () => {
    const long = 'a'.repeat(33);
    expect(extractMentions(`@${long}`)).toEqual([]);
  });

  it('32 位用户名合法', () => {
    const ok = 'a'.repeat(32);
    expect(extractMentions(`@${ok}`)).toEqual([ok]);
  });

  /**
   * ⚠️ v0.0.5 新增：**与注册校验的一致性守护**
   *
   * 实测踩到（E2E 首次失败）：`mentions.ts` 的 `USERNAME_RE` 写的是
   * `{3,20}`，而 `signup/route.ts` 允许的是 `{2,32}`
   * ⇒ **13–32 字符的合法用户名永远无法被提及**，
   * 而且用户**得不到任何提示**（@ 了但没通知）。
   *
   * 这条断言保证两处规则**永远一致** ——
   * 将来任何一边改了长度上限，另一边没跟上 ⇒ 测试立刻红。
   */
  it('提及的用户名规则与注册校验一致', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const signup = readFileSync(
      path.join(__dirname, '..', 'src', 'app', 'api', 'auth', 'signup', 'route.ts'),
      'utf8',
    );
    const mentions = readFileSync(
      path.join(__dirname, '..', 'src', 'lib', 'mentions.ts'),
      'utf8',
    );

    const extract = (src: string): string | null => {
      const m = /USERNAME_RE\s*=\s*\/\^\[a-zA-Z0-9_\]\{(\d+),(\d+)\}\$\//.exec(src);
      return m ? `${m[1]}-${m[2]}` : null;
    };

    const signupRange = extract(signup);
    const mentionsRange = extract(mentions);

    expect(signupRange, '应能从 signup 路由解析出用户名长度区间').not.toBeNull();
    expect(mentionsRange, '应能从 mentions 模块解析出用户名长度区间').not.toBeNull();
    expect(
      mentionsRange,
      `提及的用户名规则（${mentionsRange}）必须与注册校验（${signupRange}）一致 —— ` +
        `否则合法用户名的 @ 提及会静默失效`,
    ).toBe(signupRange);
  });

  it('下划线是合法字符', () => {
    expect(extractMentions('@some_user_1 看看')).toEqual(['some_user_1']);
  });

  it('中文用户名不提取（本站用户名限字母数字下划线）', () => {
    expect(extractMentions('@中文用户 你好')).toEqual([]);
  });

  it('没有 @ 时返回空数组', () => {
    expect(extractMentions('普通文本')).toEqual([]);
    expect(extractMentions('')).toEqual([]);
  });

  it('数量上限：超过 10 个只取前 10 个', () => {
    const many = Array.from({ length: 20 }, (_, i) => `@user${i}`).join(' ');
    const r = extractMentions(many);
    expect(r.length).toBe(MAX_MENTIONS_PER_CONTENT);
    expect(r[0]).toBe('user0');
  });

  it('保留出现顺序', () => {
    expect(extractMentions('@bob @alice @carol')).toEqual(['bob', 'alice', 'carol']);
  });
});

describe('v0.0.5 @ 提及 · buildMentionMessage', () => {
  it('回复里的提及带楼层号', () => {
    const msg = buildMentionMessage({
      actorName: 'alice',
      topicTitle: '标题',
      isReply: true,
      floor: 12,
    });
    expect(msg).toContain('alice');
    expect(msg).toContain('#12');
    expect(msg).toContain('标题');
  });

  it('主题里的提及不带楼层号', () => {
    const msg = buildMentionMessage({
      actorName: 'alice',
      topicTitle: '标题',
      isReply: false,
      floor: null,
    });
    expect(msg).toContain('alice');
    expect(msg).toContain('标题');
    expect(msg).not.toContain('#');
  });
});
