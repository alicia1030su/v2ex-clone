import 'server-only';
import { headers } from 'next/headers';
import { INTERNAL_CLIENT_IP_HEADER } from './client-ip-constants';

/**
 * 客户端 IP 解析（限流与审计的信任边界）
 *
 * ## 为什么需要这个模块
 *
 * 修复前的实现无条件信任 `x-forwarded-for` / `x-real-ip`：
 *
 * ```ts
 * hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? '127.0.0.1'
 * ```
 *
 * 而本项目的应用端口是**直接映射到宿主机的**
 * （`deploy/docker-compose.yml` 的 `ports: ['${APP_PORT:-3000}:3000']`），
 * 攻击者可以直连并任意伪造这两个头 ⇒ 每次请求落到不同的限流桶
 * ⇒ 登录暴力破解与批量注册限流**完全可绕过**。
 *
 * ## 信任模型
 *
 * 关键约束（实测得出）：**Next.js 15 会用 `??=` 处理 `x-forwarded-for`**：
 *
 * ```js
 * // node_modules/next/dist/server/base-server.js
 * req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress;
 * ```
 *
 * `??=` 意味着：**客户端传了这个头，Next 就不会用 socket 真实地址覆盖它**，
 * 且这一行**早于** middleware 执行。Next 15 也没有 `experimental.nodeMiddleware`
 * （实测 `config-shared.js` 中为 `undefined`），middleware 跑在 Edge Runtime，
 * 拿不到 socket 远端地址。
 *
 * 因此 middleware **无法区分**「Next 填的真实地址」与「客户端伪造的值」——
 * 任何在 middleware 里「洗白」代理头的做法都会让信任模型形同虚设。
 *
 * 由此确定的策略：
 *
 * | 配置 | 行为 | 适用场景 |
 * |---|---|---|
 * | `TRUST_PROXY_HEADERS=0`（默认） | **完全忽略** `x-forwarded-for` / `x-real-ip`，IP 维度限流退化为全局单桶 | 默认；不知道来源 IP 时最安全 |
 * | `TRUST_PROXY_HEADERS=1` | 采信 `x-forwarded-for` 首个地址，其次 `x-real-ip` | 应用确定位于反向代理之后 |
 *
 * > **重要取舍**：默认配置下 IP 维度限流是「全局单桶」（所有客户端共用一个桶），
 * > 这**安全但粗糙**。账号维度的限流（例如登录的 `ip|username`）仍然有效，
 * > 因此针对**同一账号**的暴力破解仍会被拦截。
 * > 要拿到真实来源 IP，必须部署在反向代理之后并显式设 `TRUST_PROXY_HEADERS=1`。
 *
 * 另有一层加固建议（见 `docs/DEPLOYMENT.md`）：
 * 把应用端口绑到 `127.0.0.1`（`127.0.0.1:3000:3000`），
 * 使应用只能经反向代理访问 —— 这从根本上消除了「直连伪造头」的可能。
 */

/** middleware 注入的内部头（客户端传入的同名头会被剥离） */
export { INTERNAL_CLIENT_IP_HEADER };

/** 未取到真实来源时的兜底值 */
const FALLBACK_IP = '127.0.0.1';

/**
 * 是否信任反向代理头。
 *
 * 默认 `0`（不信任）。只有在「应用确定位于反向代理之后，
 * 且代理会正确覆盖（而非追加）x-forwarded-for」时才应设为 `1`。
 */
export function isProxyHeaderTrusted(): boolean {
  return process.env.TRUST_PROXY_HEADERS === '1';
}

/** 从 `x-forwarded-for` 取最左侧地址（最靠近客户端的那个） */
function firstForwardedFor(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first || null;
}

/** 归一化：去掉 IPv6 映射前缀与方括号，便于稳定分桶 */
function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  let v = ip.trim();
  if (!v) return null;
  // [::1]:1234 → ::1
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    if (end > 0) v = v.slice(1, end);
  }
  // ::ffff:1.2.3.4 → 1.2.3.4
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) v = mapped[1];
  return v;
}

/**
 * 解析限流用的客户端 IP。
 *
 * @param h 传入的请求头（便于测试注入；生产环境省略即取当前请求的 headers）
 */
export async function resolveClientIp(
  h?: { get(name: string): string | null },
): Promise<string> {
  const hdrs = h ?? (await headers());

  if (isProxyHeaderTrusted()) {
    const forwarded = normalizeIp(firstForwardedFor(hdrs.get('x-forwarded-for')));
    if (forwarded) return forwarded;
    const realIp = normalizeIp(hdrs.get('x-real-ip'));
    if (realIp) return realIp;
  }

  // 不信任代理头时，只用 middleware 注入的内部头。
  // 该头由 middleware 负责剥离客户端伪造值后再写入。
  const internal = normalizeIp(hdrs.get(INTERNAL_CLIENT_IP_HEADER));
  return internal ?? FALLBACK_IP;
}
