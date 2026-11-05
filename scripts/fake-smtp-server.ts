/**
 * fake SMTP server 的 CLI 包装（v0.0.5）
 *
 * ## 用途
 *
 * CI 的「忘记密码」全链路 E2E 需要邮件**真的投递出去**，
 * 才能验证「邮件进箱 → 链接有效 → 改密 → 旧会话失效」这条链路。
 *
 * CI 没有（也不该有）外部 SMTP 凭据，所以本脚本在本地起一个
 * 极简 SMTP server，监听指定端口，供应用连接。
 *
 * ## 用法
 *
 * ```bash
 * npx tsx scripts/fake-smtp-server.ts 3025
 * ```
 *
 * 端口默认 3025。
 *
 * ## ⚠️ 安全边界
 *
 * - 只监听 **127.0.0.1**（不对外暴露）
 * - **不写任何真实邮箱** —— 收到的邮件只打印到 stdout
 * - **仅用于测试环境** —— 生产环境绝不该启动这个进程
 */

import { FakeSmtpServer } from '../tests/helpers/fake-smtp-server';

async function main(): Promise<void> {
  const port = Number(process.argv[2] ?? 3025);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`[fake-smtp] 端口参数无效：${process.argv[2]}`);
    process.exit(1);
  }

  const server = await FakeSmtpServer.start({ port });

  console.log(`[fake-smtp] 已启动，监听 127.0.0.1:${server.port}`);
  console.log('[fake-smtp] 收到的邮件会打印到 stdout（不写任何真实邮箱）');

  server.on('mail', (mail) => {
    console.log(
      `[fake-smtp] 收到邮件：from=${mail.from} to=${mail.to.join(',')} subject=${mail.subject}`,
    );
  });

  const shutdown = async () => {
    console.log('[fake-smtp] 收到退出信号，正在关闭…');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((err) => {
  console.error('[fake-smtp] 启动失败：', err);
  process.exit(1);
});
