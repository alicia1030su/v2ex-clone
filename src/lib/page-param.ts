/**
 * `page` 查询参数的统一解析（v0.0.14 P0-2 姊妹项）
 *
 * ## 为什么需要单独一层
 *
 * 全仓 10 个分页页面此前各自手写同一行：
 *
 * ```ts
 * const page = Math.max(1, Number(p ?? 1) || 1);
 * ```
 *
 * 这一行有**三个真实缺陷**，且都不是"理论问题"：
 *
 * 1. **`Number('1.5')` = 1.5 ⇒ 直接进 SQL 的 `OFFSET`**。
 *    PostgreSQL 对 `OFFSET 1.5` 报
 *    `invalid input syntax for type bigint: "1.5"` ⇒ 整页 500。
 *    同理 `'1e3'`（1000）、`' 2 '`（2）、`'0x10'`（16）都会被 `Number()` 接受，
 *    其中 `'1.5'` 直接炸，其余是"用户没要的结果"。
 * 2. **`'Infinity'` ⇒ `Number('Infinity')` 是 `Infinity`**，
 *    `Math.max(1, Infinity)` 还是 `Infinity` ⇒ `OFFSET Infinity` 又炸。
 *    `'Infinity'` 是**合法 URL 查询值**，不是臆想输入。
 * 3. **没有上限**：`?p=999999999` ⇒ `OFFSET 19999999980`。
 *    深翻页是数据库最讨厌的查询形态（PostgreSQL 需要逐行扫描并丢弃），
 *    一个脚本就能把库拖到 CPU 100%；而第 999999 页**本来也没有内容**。
 *
 * ## 为什么"超上限钳到上限"而不是"回退到第 1 页"
 *
 * 这是刻意选择，不是随手写的：
 *
 * - 回退到 1 ⇒ 用户翻到第 1001 页时**莫名其妙回到首页**，且 URL 仍是 `?p=1001`
 *   （地址栏与实际内容不一致，刷新行为"诡异"，属体验缺陷）；
 * - 钳到上限 ⇒ 用户停在第 1000 页（空列表 + 正常的页码导航），行为可解释。
 *
 * 页面侧应同时把 `totalPages` 也钳在 `MAX_PAGE` 以内，两者一致才不会出现
 * "导航显示第 1001 页、实际查的是第 1000 页"的错位。
 *
 * ## 为什么必须是纯模块
 *
 * 无 `server-only`、无数据库依赖 ⇒ 可以被服务端组件、客户端组件与单元测试
 * 同时引用（本仓 V13-01 的教训：同一段解析逻辑各写一份必然漂移）。
 */

/**
 * 页码上限（含）。
 *
 * 取 1000 的理由：按每页 20 条计，1000 页 = 20000 条，已远超任何真实
 * 节点的可读深度；同时把 `OFFSET` 压在 20000 以内，让数据库始终走
 * "索引扫描 + 丢弃前 N 行"，不会退化成全表扫描。
 */
export const MAX_PAGE = 1000;

/** `parsePageParam` 的可选参数 */
export interface ParsePageOptions {
  /** 自定义上限（默认 {@link MAX_PAGE}）；非法值回退到默认上限 */
  max?: number;
}

/**
 * 取生效的上限：非法输入（`NaN` / `Infinity` / `< 1` / 非数字）一律回退到
 * {@link MAX_PAGE} —— **绝不**因为调用方传错上限而让页码失去上界。
 */
function resolveMax(opts?: ParsePageOptions): number {
  const raw = opts?.max;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MAX_PAGE;
  const floored = Math.floor(raw);
  return floored >= 1 ? floored : MAX_PAGE;
}

/**
 * 解析 `page` 查询参数。
 *
 * 规则（每条都有单元测试钉住，见 `tests/page-param.spec.ts`）：
 *
 * | 输入 | 结果 | 说明 |
 * |---|---|---|
 * | `undefined` / `null` / `''` / `'   '` | `1` | 未传 / 空值视为第 1 页 |
 * | `'abc'` / `'1.5'` / `'NaN'` / `'Infinity'` / `'-3'` / `'0'` / `'1e3'` | `1` | 非法 ⇒ 第 1 页 |
 * | `'1'` / `'42'` / `' 7 '` | 原值 | 合法正整数（允许首尾空白与 `+` 号） |
 * | `'1001'`（> 上限） | `MAX_PAGE` | 钳制，**不回退到 1** |
 * | `['1', '2']` | 取第一个（`'1'` → 1） | `?p=1&p=2` 时 Next 给出数组 |
 *
 * 实现上刻意**不用 `parseInt`**：`parseInt('1.5')` = 1、`parseInt('12abc')` = 12，
 * 会把非法输入"猜"成一个合法值，掩掉真正的错误来源。这里用十进制整数正则
 * 先做**格式判定**，再用 `Number` 取值，两者职责分离。
 *
 * @param raw  Next.js `searchParams` 给出的原始值（可能是数组）
 * @param opts 可选上限覆盖
 * @returns 一定落在 `[1, max]` 区间内的整数页码
 */
export function parsePageParam(
  raw: string | string[] | undefined | null,
  opts?: ParsePageOptions,
): number {
  const max = resolveMax(opts);

  // `?p=1&p=2` 时 Next.js 给数组：取第一个（与 `URLSearchParams.get()` 语义一致）。
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null) return 1;

  // 运行时防御：类型标注之外仍可能拿到非字符串（例如 `?p` 被框架解析成数组里的对象）。
  if (typeof value !== 'string') return 1;

  const trimmed = value.trim();
  if (trimmed === '') return 1;

  // 只接受十进制非负整数：`-3` / `1.5` / `1e3` / `0x10` / `NaN` / `Infinity` 全部落空。
  if (!/^\+?\d+$/.test(trimmed)) return 1;

  const parsed = Number(trimmed);
  // 位数极多时 `Number` 会得到 `Infinity` 或超过安全整数的值 —— 一律按"超上限"处理。
  if (!Number.isFinite(parsed)) return max;
  if (parsed < 1) return 1;
  if (parsed > max) return max;
  if (!Number.isSafeInteger(parsed)) return max;

  return parsed;
}

/**
 * 把 `(page, perPage)` 换算成 SQL `OFFSET`，并保证**永不溢出**。
 *
 * 为什么单独一个函数：`(page - 1) * perPage` 在极端输入下会越过
 * `Number.MAX_SAFE_INTEGER`（`2^53 - 1`），此后 `Number` 的整数运算
 * 开始丢精度，再传给 `postgres` 就会被序列化成
 * `1e+21` 这种非整数文本 ⇒ PostgreSQL 报
 * `invalid input syntax for type bigint` ⇒ 整页 500。
 *
 * 因此这里做三层钳制：
 *  1. `page` / `perPage` 非法（非有限数、< 1）时回退到安全值（1）；
 *  2. 乘积非安全整数时直接取 `Number.MAX_SAFE_INTEGER`；
 *  3. 若调用方给了 `maxOffset`，再钳一次（用于"最多翻到第 N 页"的业务约束）。
 *
 * 约定：**返回的是 `OFFSET`（从 0 开始），不是页码** ——
 * 即 `clampOffset(1, 20) === 0`，与全仓 `.offset((page - 1) * TOPICS_PER_PAGE)` 一致。
 *
 * @param page      页码（≥ 1）
 * @param perPage   每页条数（≥ 1）
 * @param maxOffset 可选的最大偏移（≥ 0）；不给则只受 `Number.MAX_SAFE_INTEGER` 约束
 * @returns `[0, min(maxOffset, MAX_SAFE_INTEGER)]` 区间内的整数
 */
export function clampOffset(page: number, perPage: number, maxOffset?: number): number {
  const safePage =
    Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const safePerPage =
    Number.isFinite(perPage) && perPage >= 1 ? Math.floor(perPage) : 1;

  const product = (safePage - 1) * safePerPage;
  const offset = Number.isSafeInteger(product) ? product : Number.MAX_SAFE_INTEGER;

  const limit =
    typeof maxOffset === 'number' && Number.isFinite(maxOffset) && maxOffset >= 0
      ? Math.min(Math.floor(maxOffset), Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;

  return Math.max(0, Math.min(offset, limit));
}
