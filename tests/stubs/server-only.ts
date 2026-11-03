/**
 * server-only 的测试替身
 *
 * 真实模块在非 React Server Component 环境中会直接抛错。
 * 单元测试运行在纯 Node 下，因此用空模块替代 ——
 * 它只提供编译期的语义标记，没有运行时行为。
 */
export {};
