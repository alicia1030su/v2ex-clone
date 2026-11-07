/**
 * 独立进程版 fake SMTP server（v0.0.8）
 *
 * ## 为什么从「测试进程内」改成「独立进程」
 *
 * v0.0.7 的 Linux 矩阵里，「密码重置全链路」偶发超时（同一提交重跑即过）。
 * 根因分析（见 docs/SECURITY_AUDIT_v0.0.8.md §SMTP）：
 *
 *   原来的 fake server 跑在 **Playwright worker 进程内**，与浏览器协议
 *   处理**共用事件循环**。worker 忙于页面导航 / hydration 等待时，
 *   SMTP socket 的 'data' 事件被延迟处理 ⇒ 客户端（Next 服务）的
 *   空闲超时竞速触发 ⇒ 投递失败 ⇒ 邮件永远不到。
 *
 *   同类问题在任何「同一进程内既当服务器又当测试驱动器」的组合都存在。
 *
 * ## 协议（stdout JSON-lines，单向通知）
 *
 *   → stdin:  {"cmd":"quit"}           （可选；也可直接 SIGTERM）
 *   ← stdout: {"type":"ready","port":N,"pid":P}
 *   ← stdout: {"type":"mail","seq":N,"from":"…","to":[…],"subject":"…","body":"…"}
 *   ← stdout: {"type":"stopped","received":N,"openSockets":M,"exitCode":0}
 *   ← stdout: {"type":"error","message":"…"}
 *
 * 消费方（Playwright spec / 安全审计脚本）按**行事件**驱动，
 *   不轮询、不固定 sleep：ready 之后才发请求，mail 事件到达即断言。
 *
 * ## 环境变量
 *
 *   SMTP_PORT   监听端口（默认 3025；测试传分片端口）
 *   SMTP_HOST   监听地址（默认 127.0.0.1，只绑回环）
 */

import { FakeSmtpServer } from './fake-smtp-server';

const PORT = Number(process.env.SMTP_PORT ?? 3025);
const HOST = process.env.SMTP_HOST ?? '127.0.0.1';

/** 写一行 JSON 到 stdout（flush 由 console.log 保证） */
function emit(obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function main(): Promise<void> {
  let server: FakeSmtpServer;
  try {
    server = await FakeSmtpServer.start({ port: PORT });
  } catch (err) {
    emit({ type: 'error', phase: 'start', message: (err as Error).message });
    process.exit(1);
    return;
  }

  // 监听端口**实际值**回传（port=0 时由内核分配，见 FakeSmtpServer.start）
  const actualPort = server.port;
  emit({ type: 'ready', port: actualPort, host: HOST, pid: process.pid });

  let seq = 0;
  server.on('mail', (mail) => {
    seq += 1;
    emit({
      type: 'mail',
      seq,
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      body: mail.body,
      messageId: mail.messageId,
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.stop();
      emit({
        type: 'stopped',
        received: server.received.length,
        openSockets: 0,
        exitCode: 0,
        signal,
      });
      process.exit(0);
    } catch (err) {
      emit({ type: 'error', phase: 'stop', message: (err as Error).message });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // stdin 命令（备用通道：某些环境信号不可靠时用）
  process.stdin.setEncoding('utf8');
  let stdinBuf = '';
  process.stdin.on('data', (chunk: string) => {
    stdinBuf += chunk;
    let idx: number;
    while ((idx = stdinBuf.indexOf('\n')) >= 0) {
      const line = stdinBuf.slice(0, idx).trim();
      stdinBuf = stdinBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { cmd?: string };
        if (msg.cmd === 'quit') void shutdown('quit-cmd');
      } catch {
        /* 忽略无法解析的行 */
      }
    }
  });
  process.stdin.on('end', () => {
    // stdin 关闭（父进程退出）⇒ 一并退出，防僵尸
    if (!shuttingDown) void shutdown('stdin-end');
  });

  // 父进程消失（CI 里父进程被 kill）⇒ stdin 会 end，上面已覆盖；
  // 双保险：ppid 变了也退出。
  const ppid = process.ppid;
  const guard = setInterval(() => {
    if (process.ppid !== ppid) {
      clearInterval(guard);
      void shutdown('ppid-changed');
    }
  }, 2000);
  guard.unref();

  emit({ type: 'listening', port: actualPort, host: HOST });
}

void main();
