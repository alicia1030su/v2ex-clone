import { describe, it, expect } from 'vitest';
import { safeDecode } from '../src/lib/safe-decode';

/**
 * `safeDecode` 单元测试（v0.0.14）
 *
 * ## 这个函数存在的原因（一段真实弯路）
 *
 * `/tag/[name]` 原本用裸 `decodeURIComponent(name)`。我看到「其他动态段页面
 * 都没解码」就**凭猜测**判定它是「二次解码」，把解码删掉了 ——
 * 结果判别实验立刻打脸：中文标签 `/tag/%E5%89%8D%E7%AB%AF` 变成 404。
 *
 * 实测结论：**Next.js 的 App Router 不预解码动态段参数**，解码必须由页面做。
 * 但裸 decode 遇到字面量 `%`（`/tag/100%`）会抛 `URIError` ⇒ 整页 500。
 *
 * 所以正确解不是「删掉解码」，而是「解码但容错」。这个测试锁住后者的语义。
 */

describe('safeDecode', () => {
  it('正常百分号编码：正确解码（中文 / 空格 / 斜杠）', () => {
    expect(safeDecode('%E5%89%8D%E7%AB%AF')).toBe('前端');
    expect(safeDecode('next.js%20app')).toBe('next.js app');
    expect(safeDecode('a%2Fb')).toBe('a/b');
  });

  it('已解码的纯文本原样返回（幂等）', () => {
    expect(safeDecode('react')).toBe('react');
    expect(safeDecode('前端')).toBe('前端');
    expect(safeDecode('')).toBe('');
  });

  it('非法编码不抛异常，原样返回（让调用方走 404 而不是 500）', () => {
    // `%` 后不跟两位十六进制 —— 裸 decodeURIComponent 会抛 URIError
    expect(() => safeDecode('100%')).not.toThrow();
    expect(safeDecode('100%')).toBe('100%');
    expect(safeDecode('%E5%89')).toBe('%E5%89'); // 截断的多字节序列
    expect(safeDecode('%ZZ')).toBe('%ZZ');
  });

  it('裸 decodeURIComponent 在这些输入上确实会抛（证明本函数必要）', () => {
    for (const bad of ['100%', '%E5%89', '%ZZ']) {
      expect(() => decodeURIComponent(bad), `${bad} 本应抛错`).toThrow();
      expect(() => safeDecode(bad), `${bad} 不应抛错`).not.toThrow();
    }
  });
});
