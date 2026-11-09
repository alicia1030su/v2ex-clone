/**
 * 安全解码动态段参数（v0.0.14）
 *
 * ## 为什么不是直接用 `decodeURIComponent`
 *
 * 两个事实，都是**实测**得到的，不是读文档猜的：
 *
 * 1. **Next.js 的 App Router 不预解码动态段参数。**
 *    证据：删掉 `/tag/[name]` 里的解码后，`/tag/%E5%89%8D%E7%AB%AF`（中文标签）
 *    直接 404；恢复解码后 200。判别用例见
 *    `e2e/v014-tags.spec.ts` 的「中文标签百分号编码路径必须能命中」。
 *    所以**必须**在这里解码一次。
 *
 * 2. **裸 `decodeURIComponent` 遇到字面量 `%` 会抛异常。**
 *    `/tag/100%25` 进来是字符串 `100%25`；用户直接访问 `/tag/100%` 时
 *    拿到的是 `100%`，`decodeURIComponent('100%')` 抛
 *    `URIError: URI malformed` ⇒ **整页 500**（应为 404）。
 *
 * ## 语义
 *
 * 解码成功 → 返回解码结果；解码失败 → **原样返回**。
 * 后者让调用方走正常的「查不到 ⇒ 404」路径，而不是 500。
 *
 * ⚠️ 不要把这个函数用于**已经解码过**的值（会二次解码）——
 * 判断依据只能是实测各框架的实际行为，不要凭印象。
 */
export function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
