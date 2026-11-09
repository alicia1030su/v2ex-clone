import { describe, it, expect } from 'vitest';
import {
  normalizeTag,
  normalizeTags,
  TAG_MAX_LENGTH,
  TAG_MAX_PER_TOPIC,
} from '../src/lib/tag-normalize';

/**
 * 标签规范化单元测试（v0.0.14）
 *
 * ## 这个测试在防什么
 *
 * `tags` / `topic_tags` 表从 v0.0.1 就在 schema 里，主题页也会渲染标签块，
 * `/tag/[name]` 更是可访问路由 —— **但生产代码从不写入**，所以标签页永远空。
 * 补写入链路时，最容易长期出问题的不是「写不进去」，而是「写进去的是脏数据」：
 *
 *   · `React` 与 `react` 变成两个标签（用户同一概念分裂）；
 *   · `next.js app router` 带空格进库 ⇒ `/tag/next.js app router` 链接不可用；
 *   · 用户写 `#react` 把井号带进库；
 *   · 一次粘贴 30 个标签 ⇒ 主题页标签块把正文挤下去；
 *   · emoji / 全角符号进库 ⇒ 生成的 `/tag/` 链接 404。
 *
 * 这些都是**纯函数层能一次测准**的，不该留给 E2E 去猜。
 */

describe('normalizeTag：单标签', () => {
  it('基本规范化：去空白、小写、去井号', () => {
    expect(normalizeTag('  React  ')).toBe('react');
    expect(normalizeTag('#react')).toBe('react');
    expect(normalizeTag('##Next.js')).toBe('next.js');
  });

  it('空白折叠为连字符（保证 /tag/ 链接可用）', () => {
    expect(normalizeTag('next.js app router')).toBe('next.js-app-router');
    expect(normalizeTag('a\tb')).toBe('a-b');
    expect(normalizeTag('a   b')).toBe('a-b');
  });

  it('保留中英文数字与合法符号', () => {
    expect(normalizeTag('前端')).toBe('前端');
    expect(normalizeTag('Node_JS')).toBe('node_js');
    expect(normalizeTag('v0.0.14')).toBe('v0.0.14');
  });

  it('剔除 emoji / 标点 / 全角符号（避免生成 404 的标签链接）', () => {
    expect(normalizeTag('react🔥')).toBe('react');
    expect(normalizeTag('（前端）')).toBe('前端');
    expect(normalizeTag('!!!')).toBeNull();
  });

  it('纯非法字符 ⇒ null（丢弃，而不是写进库）', () => {
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('#')).toBeNull();
    expect(normalizeTag('---')).toBeNull();
    expect(normalizeTag(123 as unknown)).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
    expect(normalizeTag(null)).toBeNull();
  });

  it('长度边界：1..24', () => {
    expect(normalizeTag('a')).toBe('a');
    expect(normalizeTag('a'.repeat(TAG_MAX_LENGTH))).toBe('a'.repeat(TAG_MAX_LENGTH));
    // 超长不是截断而是丢弃 —— 截断会静默改变用户语义（"abcdef…" 变成另一个词）
    expect(normalizeTag('a'.repeat(TAG_MAX_LENGTH + 1))).toBeNull();
  });
});

describe('normalizeTags：多标签', () => {
  it('小写归一后去重（React / react 只留一个）', () => {
    expect(normalizeTags(['React', 'react', 'REACT'])).toEqual(['react']);
  });

  it('保留用户输入顺序（展示顺序即用户顺序）', () => {
    expect(normalizeTags(['b', 'a', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('逗号分隔字符串同样支持（前端传原始 input 值）', () => {
    expect(normalizeTags('react, next.js , 前端')).toEqual(['react', 'next.js', '前端']);
  });

  it('最多 5 个，超出静默截断（不报错，不阻断发布）', () => {
    const many = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    expect(normalizeTags(many)).toHaveLength(TAG_MAX_PER_TOPIC);
    expect(normalizeTags(many)).toEqual(['tag0', 'tag1', 'tag2', 'tag3', 'tag4']);
  });

  it('非法项被跳过而不是占用名额', () => {
    // 🔥 与 !!! 都无法构成标签 ⇒ 后两个合法项应当仍然入选
    expect(normalizeTags(['🔥', 'react', '!!!', 'next.js'])).toEqual(['react', 'next.js']);
  });

  it('非数组非字符串 ⇒ 空数组（不抛错）', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags({} as unknown)).toEqual([]);
    expect(normalizeTags(42)).toEqual([]);
  });

  it('空输入 ⇒ 空数组（调用方据此跳过落库）', () => {
    expect(normalizeTags('')).toEqual([]);
    expect(normalizeTags([])).toEqual([]);
    expect(normalizeTags(' , , ')).toEqual([]);
  });
});

describe('幂等性与不动点', () => {
  it('规范化两次结果相同（禁止「规范化后仍可再变」）', () => {
    const samples = ['  React  ', 'next.js app router', '#前端', 'Node_JS', 'v0.0.14'];
    for (const s of samples) {
      const once = normalizeTag(s);
      if (once === null) continue;
      expect(normalizeTag(once), `「${s}」二次规范化发生变化`).toBe(once);
    }
  });

  it('数组规范化逐项等价（防止两种入口口径漂移）', () => {
    const raw = ['  React ', 'next.js   app', '#前端'];
    expect(normalizeTags(raw)).toEqual(
      raw.map((r) => normalizeTag(r)).filter((t): t is string => t !== null),
    );
  });
});
