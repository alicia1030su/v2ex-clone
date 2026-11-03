/**
 * 客户端 IP 相关常量
 *
 * 单独成文件的原因：middleware 不能 import 带 `server-only` 的模块
 * （`server-only` 只能在 Server Component / Route Handler 中使用，
 *  middleware 属于 Edge Runtime，import 会直接抛错）。
 */

/** middleware 注入的内部头（客户端传入的同名头会被剥离） */
export const INTERNAL_CLIENT_IP_HEADER = 'x-v2-client-ip';
