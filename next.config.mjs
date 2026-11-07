/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['postgres', 'ioredis'],

  // ---------------------------------------------------------------------
  // v0.0.9：启用 instrumentation 钩子（任务书 §六）
  //
  // `src/instrumentation.ts` 在 **Node HTTP 层**观测真实响应状态码，
  // 修复 v0.0.8「API 请求数恒为 0、byStatus 恒为 {200}」的缺陷。
  //
  // 为什么不用 middleware：middleware 拿不到下游路由的真实状态码
  // （`NextResponse.next()` 返回的是它自己的响应，恒 200）。
  // 详见 src/instrumentation.ts 顶部说明。
  //
  // 注：Next 15 已把 instrumentation 变成**默认开启**的稳定特性，
  //     不再需要 `experimental.instrumentationHook`（该键在 15.5 已被移除，
  //     保留会触发 "Unrecognized key(s)" 告警）⇒ 这里**不显式配置**。
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // v0.0.6：构建目录可切换（Windows EPERM 的**隔离方案**）
  //
  // 背景：本机 Windows 上 `next build` 偶发
  //   `EPERM: operation not permitted, open '.next\trace'`。
  // 专项诊断（docs/WINDOWS_EPERM_DIAGNOSIS_v0.0.6.md）确认：
  //   · 与 `.next` 的处置方式（rm -rf / mv 同卷 / mv 跨目录）**无关**
  //   · 与构建与服务存活的时序**无关**
  //   · 与文件静态权限**无关**（ReadWrite/Write/Create 三种模式都可写）
  //   · 与构建目录是否被复用**无关**
  //   ⇒ 机制未查明，但**故障点固定在 `.next/trace` 这个具体文件上**。
  //
  // 隔离方案：把构建产物放到**另一个目录**，避开那个被占用的路径。
  //   NEXT_DIST_DIR=.next-iso npm run build   ⇒ 产物落在 .next-iso/
  // 脚本 `scripts/ci/run-e2e-locally.sh` 与 `scripts/ci/run-visual-regression.sh`
  // 在 EPERM 时会自动切换到隔离目录重试。
  //
  // ⚠️ 默认仍是 `.next`（保持与 CI、Docker、部署流程完全一致）——
  //    隔离只在**检测到 EPERM** 时启用，不改变正常路径。
  // ---------------------------------------------------------------------
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
