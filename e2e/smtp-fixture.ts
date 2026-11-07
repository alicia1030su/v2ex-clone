/**
 * E2E SMTP fixture（v0.0.8）
 *
 * 用**独立进程**跑 fake SMTP server，以 stdout JSON-lines 事件驱动：
 *
 *   · ready   —— TCP 监听就绪（父进程收到才发请求，无固定 sleep）
 *   · mail    —— 一封邮件**完整收到**（父进程收到才断言，无轮询）
 *   · stopped —— 优雅退出确认（父进程校验 received/openSockets）
 *
 * 这取代 v0.0.7 及以前的「worker 进程内起 server + expect.poll 轮询」：
 * 后者与浏览器协议处理共用一个事件循环，是矩阵里
 * 「密码重置全链路」偶发超时的根因（详见 fake-smtp-standalone.ts 头注）。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** standalone server 发出的一封邮件（与 fake-smtp-server.ts 的 ReceivedMail 对齐） */
export type SmtpMail = {
  seq: number;
  from: string;
  to: string[];
  subject: string;
  body: string;
  messageId: string;
};

/** server 优雅停止时回报的资源状态 */
export type SmtpStopInfo = {
  received: number;
  openSockets: number;
  exitCode: number;
};

export type SmtpFixture = {
  /** server 实际监听端口 */
  readonly port: number;
  /** 已收到的全部邮件（按到达顺序；等待请用 waitForMail，勿轮询此数组） */
  readonly received: SmtpMail[];
  /**
   * 等待一封满足条件的邮件（**事件驱动，非轮询**）。
   *
   * @param predicate 可选过滤（如按收件人匹配）；默认任意邮件
   * @param timeoutMs 超时；错误信息带「已收到的邮件数」便于定位
   */
  waitForMail(predicate?: (mail: SmtpMail) => boolean, timeoutMs?: number): Promise<SmtpMail>;
  /** 优雅停止并校验资源释放（openSockets 必须为 0、退出码必须为 0） */
  stop(): Promise<SmtpStopInfo>;
  /** 强制 kill（仅用于异常路径的清理） */
  kill(): void;
};

type PendingWait = {
  predicate: (mail: SmtpMail) => boolean;
  resolve: (mail: SmtpMail) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

/** 解析 tsx CLI 入口（devDependency；CI 上 npm ci 后必然存在） */
function resolveTsxBin(): string {
  const { createRequire } = require('node:module') as typeof import('node:module');
  const req = createRequire(import.meta.url);
  return req.resolve('tsx/dist/cli.mjs');
}

/**
 * 启动独立 fake SMTP server 并等到 **ready 事件**。
 *
 * @param port 0 = 自动选端口（默认 0，彻底避免端口冲突）
 */
export async function startSmtpFixture(port = 0): Promise<SmtpFixture> {
  const script = path.join(__dirname, 'fake-smtp-standalone.ts');
  const child: ChildProcess = spawn(process.execPath, [resolveTsxBin(), script], {
    env: { ...process.env, SMTP_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // ── 状态（先声明后使用，避免 TDZ）──
  const received: SmtpMail[] = [];
  const consumedSeqs = new Set<number>();
  const pendingWaits: PendingWait[] = [];
  let stderrBuf = '';
  let exited = false;
  let exitInfo: { code: number | null; signal: string | null } = { code: null, signal: null };
  let stopInfo: SmtpStopInfo | null = null;
  let stopResolve: ((info: SmtpStopInfo) => void) | null = null;
  let stopReject: ((err: Error) => void) | null = null;
  const stopPromise = new Promise<SmtpStopInfo>((res, rej) => {
    stopResolve = res;
    stopReject = rej;
  });
  let readyResolve: (port: number) => void = () => {};
  let readyReject: (err: Error) => void = () => {};
  const readyPromise = new Promise<number>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  const failAll = (err: Error) => {
    // 等待中的邮件承诺立即失败（服务消失不能静默挂起）
    for (const w of pendingWaits.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    readyReject(err);
    stopReject?.(err);
  };

  /** 扫描已收到但未被消费的邮件，返回第一个匹配者（消费语义防重复匹配） */
  const matchUnconsumed = (
    predicate: (mail: SmtpMail) => boolean,
  ): SmtpMail | null => {
    for (const m of received) {
      if (consumedSeqs.has(m.seq)) continue;
      let matched = false;
      try {
        matched = predicate(m);
      } catch {
        matched = false;
      }
      if (matched) {
        consumedSeqs.add(m.seq);
        return m;
      }
    }
    return null;
  };

  const onMail = (mail: SmtpMail) => {
    received.push(mail);
    // 唤醒匹配的等待者（事件驱动，无轮询）
    for (let i = pendingWaits.length - 1; i >= 0; i--) {
      const w = pendingWaits[i];
      const hit = matchUnconsumed(w.predicate);
      if (hit) {
        pendingWaits.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(hit);
      }
    }
  };

  // ── stdout JSON-lines 解析 ──
  const rl: ReadlineInterface = createInterface({ input: child.stdout! });
  rl.on('line', (line: string) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // 非 JSON 行（tsx banner 等）忽略
    }
    if (msg.type === 'ready') {
      readyResolve(Number(msg.port));
    } else if (msg.type === 'mail') {
      onMail({
        seq: Number(msg.seq),
        from: String(msg.from ?? ''),
        to: Array.isArray(msg.to) ? (msg.to as string[]) : [],
        subject: String(msg.subject ?? ''),
        body: String(msg.body ?? ''),
        messageId: String(msg.messageId ?? ''),
      });
    } else if (msg.type === 'stopped') {
      stopInfo = {
        received: Number(msg.received),
        openSockets: Number(msg.openSockets),
        exitCode: Number(msg.exitCode),
      };
      stopResolve?.(stopInfo);
    } else if (msg.type === 'error') {
      failAll(
        new Error(`fake SMTP server 错误（${String(msg.phase)}）：${String(msg.message)}`),
      );
    }
  });

  // ── 进程生命周期 ──
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf8');
  });
  child.on('error', (err) => {
    failAll(new Error(`fake SMTP server 进程无法启动：${err.message}`));
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
    if (!stopInfo) {
      // 没收到 stopped 事件就退出 ⇒ 非优雅退出
      stopReject?.(
        new Error(
          `fake SMTP server 非优雅退出（code=${code} signal=${signal}）` +
            (stderrBuf ? `\nstderr:\n${stderrBuf.slice(0, 500)}` : ''),
        ),
      );
    }
    // 还在等待邮件的承诺不能静默挂起 —— 由 waitForMail 的超时兜底，
    // 这里再把 ready 承诺失败掉（进程没了不可能就绪）。
    readyReject(new Error(`fake SMTP server 进程已退出（code=${code} signal=${signal}）`));
  });

  // ── 等待就绪（带明确超时与 stderr 上下文）──
  const READY_TIMEOUT_MS = 20_000;
  const readyTimer = setTimeout(() => {
    readyReject(
      new Error(
        `fake SMTP server ${READY_TIMEOUT_MS}ms 内未就绪` +
          (stderrBuf ? `\nstderr:\n${stderrBuf.slice(0, 500)}` : ''),
      ),
    );
  }, READY_TIMEOUT_MS);
  let readyPort: number;
  try {
    readyPort = await readyPromise;
  } finally {
    clearTimeout(readyTimer);
  }
  if (readyPort === 0 && port !== 0) readyPort = port;

  return {
    port: readyPort,
    received,

    waitForMail(predicate, timeoutMs = 20_000) {
      // 先扫描已收到的（邮件可能先于 wait 调用到达 —— 竞态防护）
      const already = matchUnconsumed(predicate ?? (() => true));
      if (already) return Promise.resolve(already);
      return new Promise<SmtpMail>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = pendingWaits.findIndex((w) => w.resolve === resolve);
          if (idx >= 0) pendingWaits.splice(idx, 1);
          reject(
            new Error(
              `${timeoutMs}ms 内未收到邮件` +
                `（已收到 ${received.length} 封：${received.map((m) => m.to.join(',')).join(' | ') || '无'}）`,
            ),
          );
        }, timeoutMs);
        pendingWaits.push({
          predicate: predicate ?? (() => true),
          resolve,
          reject,
          timer,
        });
      });
    },

    async stop(): Promise<SmtpStopInfo> {
      if (exited) {
        if (stopInfo) return stopInfo;
        throw new Error(`fake SMTP server 已退出但无 stopped 事件（code=${exitInfo.code}）`);
      }
      // SIGTERM ⇒ server 优雅停止 ⇒ 发 stopped 事件
      child.kill('SIGTERM');
      const info = await Promise.race([
        stopPromise,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('fake SMTP server 10s 内未确认停止')), 10_000),
        ),
      ]);
      // 等进程真正退出（防僵尸）
      await new Promise<void>((resolve) => {
        if (exited) return resolve();
        child.once('exit', () => resolve());
        setTimeout(resolve, 3000);
      });
      return info;
    },

    kill() {
      if (!exited) child.kill('SIGKILL');
    },
  };
}
