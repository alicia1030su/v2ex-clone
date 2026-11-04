import 'server-only';
import net from 'node:net';
import tls from 'node:tls';

/**
 * 最小 SMTP 客户端（零新增依赖）
 *
 * 为什么不用 nodemailer：
 *  - 它会进入生产依赖闭包，给镜像增加体积并扩大供应链攻击面
 *  - 本项目只需要发送纯文本邮件，实现所需的 SMTP 子集很小
 *
 * 支持：EHLO / STARTTLS / AUTH LOGIN / MAIL FROM / RCPT TO / DATA / QUIT。
 * 不支持：多收件人抄送、DKIM 签名。
 */

export type SmtpSendOptions = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  /** true 表示连接后立即升级为 TLS（465 端口） */
  secure?: boolean;
  timeoutMs?: number;
};

export type SmtpSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

/** 逐行读取 SMTP 响应（支持多行 "250-..." 续行） */
class SmtpSession {
  private buffer = '';
  private readonly pending: Array<(line: string) => void> = [];

  push(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      const resolver = this.pending.shift();
      if (resolver) resolver(line);
    }
  }

  /** 等待一行匹配指定码的响应 */
  expect(code: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SMTP 响应超时（期望 ${code}）`));
      }, timeoutMs);

      const handler = (line: string) => {
        clearTimeout(timer);
        if (line.startsWith(code)) {
          resolve(line);
        } else {
          reject(new Error(`SMTP 期望 ${code}，实际收到：${line}`));
        }
      };

      // 先检查缓冲区里是否已有完整行
      const idx = this.buffer.indexOf('\n');
      if (idx >= 0) {
        const line = this.buffer.slice(0, idx).replace(/\r$/, '');
        this.buffer = this.buffer.slice(idx + 1);
        handler(line);
        return;
      }
      this.pending.push(handler);
    });
  }
}

/** Base64 编码 */
function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

/** 生成 Message-ID */
function messageId(domain: string): string {
  const rand = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `<${rand}@${domain}>`;
}

/**
 * 发送一封纯文本邮件。
 *
 * 返回结果区分「成功」与「失败原因」—— 调用方据此显示真实状态，
 * 不允许把失败当成功。
 */
export async function sendMailSmtp(opts: SmtpSendOptions): Promise<SmtpSendResult> {
  const timeout = opts.timeoutMs ?? 15000;
  const useTls = opts.secure === true;

  return await new Promise<SmtpSendResult>((resolve) => {
    let settled = false;
    /** 当前活动的 socket —— STARTTLS 后会被 TLS socket 替换 */
    let sock: net.Socket | tls.TLSSocket | undefined;

    const finish = (r: SmtpSendResult) => {
      if (settled) return;
      settled = true;
      try {
        sock?.destroy();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    const session = new SmtpSession();

    const attach = (s: net.Socket | tls.TLSSocket) => {
      sock = s;
      s.setEncoding('utf8');
      s.setTimeout(timeout);
      s.on('data', (chunk: string) => session.push(chunk));
      s.on('error', (err: Error) => {
        finish({ ok: false, error: `SMTP 连接错误：${err.message}` });
      });
      s.on('timeout', () => {
        finish({ ok: false, error: 'SMTP 连接超时' });
      });
      s.on('close', () => {
        if (!settled) finish({ ok: false, error: 'SMTP 连接意外关闭' });
      });
    };

    if (useTls) {
      const ts = tls.connect({ host: opts.host, port: opts.port, servername: opts.host });
      attach(ts);
    } else {
      attach(net.connect({ host: opts.host, port: opts.port }));
    }

    const write = (line: string): boolean => {
      if (!sock?.writable) {
        finish({ ok: false, error: 'SMTP 连接不可写' });
        return false;
      }
      sock.write(line + '\r\n');
      return true;
    };

    (async () => {
      try {
        await session.expect('220', timeout);
        if (!write('EHLO v2ex-clone.local')) return;
        await session.expect('250', timeout);

        // STARTTLS（465 端口已是隐式 TLS，不需要）
        if (!useTls && opts.pass) {
          if (!write('STARTTLS')) return;
          await session.expect('220', timeout);

          // 把已连接的 socket 交给 tls.connect 接管，实现协议内升级
          const plain = sock as net.Socket;
          plain.removeAllListeners('data');
          plain.removeAllListeners('error');
          plain.removeAllListeners('close');
          plain.setTimeout(0);

          const ts = await new Promise<tls.TLSSocket>((resolve, reject) => {
            const secure = tls.connect(
              { socket: plain, servername: opts.host },
              () => resolve(secure),
            );
            secure.once('error', (e: Error) => reject(e));
          });
          attach(ts);

          if (!write('EHLO v2ex-clone.local')) return;
          await session.expect('250', timeout);
        }

        // 认证
        if (opts.user && opts.pass) {
          if (!write('AUTH LOGIN')) return;
          await session.expect('334', timeout);
          if (!write(b64(opts.user))) return;
          await session.expect('334', timeout);
          if (!write(b64(opts.pass))) return;
          await session.expect('235', timeout);
        }

        const domain = opts.from.split('@')[1] ?? 'localhost';
        const mid = messageId(domain);

        if (!write(`MAIL FROM:<${opts.from}>`)) return;
        await session.expect('250', timeout);
        if (!write(`RCPT TO:<${opts.to}>`)) return;
        await session.expect('250', timeout);
        if (!write('DATA')) return;
        await session.expect('354', timeout);

        // 正文统一为 CRLF；行首的点需转义（防止注入额外 SMTP 命令）
        const safeBody = opts.body
          .replace(/\r?\n/g, '\r\n')
          .replace(/^\./gm, '..');
        if (!write(safeBody.endsWith('\r\n') ? safeBody : safeBody + '\r\n')) return;
        if (!write('.')) return;
        await session.expect('250', timeout);

        write('QUIT');
        finish({ ok: true, messageId: mid });
      } catch (err) {
        finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
}
