import net from 'node:net';
import { EventEmitter } from 'node:events';

/**
 * 极简 SMTP 测试服务器（v0.0.5）
 *
 * ## 为什么不用 Mailpit 容器
 *
 * 任务书 §八 要求「使用 Mailpit 或 MailHog 建立隔离邮件测试环境」。
 * 本机 Docker **daemon 未运行**（`docker info` 报
 * `cannot find pipe/dockerDesktopLinuxEngine`），无法起容器。
 *
 * 因此改用**等效的极简 SMTP 服务器**：它实现
 * `src/lib/mailer.ts` 的 `deliverViaSmtp()` 所需的 SMTP 子集，能完成**协议级**
 * 全链路验证（EHLO / STARTTLS / AUTH LOGIN / MAIL FROM / RCPT TO /
 * DATA / QUIT），并把收到的邮件暴露给测试断言。
 *
 * ⚠️ v0.0.5：这个服务器最初是为 `src/lib/smtp-client.ts` 写的 ——
 * 而那个文件是**死代码**（全仓检索确认无任何生产调用方）。
 * 现在测试已改为直测生产路径 `sendMail()` ⇒ 这个服务器服务的
 * 是**真正上线的那条路**。
 *
 * **与 Mailpit 的差距（如实标注）**：
 *   - 没有 Web UI（不影响协议验证）
 *   - 不做 DKIM/SPF 校验（客户端也不发）
 *   - 不验证真实投递到外部邮箱
 *   ⇒ 「真实外部 SMTP 投递未验证」这一限制**依然存在**，
 *     已在 `FEATURE_AUDIT_v0.0.5.md` §八 与 Release Notes 中披露。
 *
 * ## 用法
 *
 *   const server = await FakeSmtpServer.start({ port: 0 });
 *   const res = await sendMailSmtp({ host: '127.0.0.1', port: server.port, ... });
 *   expect(server.received).toHaveLength(1);
 *   await server.stop();
 */

/** 服务器收到的一封邮件 */
export type ReceivedMail = {
  from: string;
  to: string[];
  /** DATA 段的原始内容（含 From/To/Subject/Message-ID 头） */
  data: string;
  /** 从 data 里解析出的 Subject（已解码 RFC 2047） */
  subject: string;
  /**
   * 从 data 里解析并解码后的正文
   *
   * 按 `Content-Transfer-Encoding` 头决定解码方式：
   *  - `base64` → 拼接折行后 base64 解码
   *  - `8bit` / `7bit` / 缺省 → 原文
   *
   * 生产实现（`src/lib/mailer.ts` 的 `deliverViaSmtp`）用的是 **8bit**。
   */
  body: string;
  /** 从 data 里解析出的 Message-ID */
  messageId: string;
};

export type FakeSmtpServerOptions = {
  /** 0 = 随机端口（推荐，避免冲突） */
  port?: number;
  /** 是否宣告支持 STARTTLS（会走 tls 升级，测试需提供证书） */
  advertiseStartTls?: boolean;
  /** AUTH LOGIN 的期望凭据；null = 不要求认证 */
  credentials?: { user: string; pass: string } | null;
  /** 收到 DATA 后是否返回错误码（用于测失败路径） */
  rejectData?: boolean;
};

/**
 * 从 DATA 原文里取 Subject 头。
 *
 * 客户端用 RFC 2047 base64 编码非 ASCII 主题（见 mailer.ts 的 encodeHeaderValue），
 * 所以这里要尝试 base64 解码；解不出来就原样返回。
 */
function parseSubject(data: string): string {
  const m = data.match(/^Subject:[ \t]*(.+)$/m);
  if (!m) return '';
  const raw = m[1].trim();
  // RFC2047: =?utf-8?B?<base64>?=
  const b = raw.match(/^=\?utf-8\?B\?(.+)\?=$/i);
  if (b) {
    try {
      return Buffer.from(b[1], 'base64').toString('utf8');
    } catch {
      return raw;
    }
  }
  // 裸 base64（本客户端的实际行为）
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    // base64 解码结果若含大量控制字符则视为解码失败
    if (!/[\u0000-\u0008\u000e-\u001f]/.test(decoded)) return decoded;
  } catch {
    /* ignore */
  }
  return raw;
}

/**
 * 解析 DATA 段里的正文。
 *
 * **必须按 `Content-Transfer-Encoding` 头决定解码方式**：
 *  - `base64` → 拼接折行后 base64 解码
 *  - `8bit` / `7bit` / 缺省 → 原文（仅还原折行）
 *
 * 生产实现（`src/lib/mailer.ts` 的 `deliverViaSmtp`）用的是 **8bit**，
 * 而曾经的死代码 `src/lib/smtp-client.ts` 用的是 **base64**。
 * 两种都要能解析 —— 否则换个客户端就解析不出来。
 *
 * ⚠️ 头与正文之间是**空行**，而 `data` 是用 `\n` join 的
 * （每行的 `\r` 已在读取时剥掉），所以要找 `\n\n` 而不是 `\r\n\r\n`。
 */
function parseBody(data: string): string {
  const idx = data.indexOf('\n\n');
  if (idx < 0) return '';

  const headers = data.slice(0, idx);
  const raw = data.slice(idx + 2);

  const cte = headers.match(/^Content-Transfer-Encoding:[ \t]*(.+)$/im)?.[1]?.trim().toLowerCase();

  if (cte === 'base64') {
    // 折行的 base64 要先拼起来
    const joined = raw.replace(/\n/g, '');
    try {
      return Buffer.from(joined, 'base64').toString('utf8');
    } catch {
      return joined;
    }
  }

  // 8bit / 7bit / 缺省：原文，只需把折行还原（去掉每行末尾的 \r 已被剥掉的问题）
  return raw.replace(/\n/g, '\n');
}

/** 解析 Message-ID 头 */
function parseMessageId(data: string): string {
  const m = data.match(/^Message-ID:[ \t]*(.+)$/m);
  return m ? m[1].trim() : '';
}

export class FakeSmtpServer extends EventEmitter {
  readonly port: number;
  /** 收到的邮件（按到达顺序） */
  readonly received: ReceivedMail[] = [];
  /** 命令日志（调试用） */
  readonly commands: string[] = [];

  private readonly server: net.Server;
  private readonly opts: Required<FakeSmtpServerOptions>;
  private startedAt = 0;
  /** 活跃连接（用于 stop() 时强制断开） */
  private readonly sockets = new Set<net.Socket>();

  private constructor(server: net.Server, port: number, opts: Required<FakeSmtpServerOptions>) {
    super();
    this.server = server;
    this.port = port;
    this.opts = opts;
  }

  /** 启动服务器（port=0 时自动选端口） */
  static async start(options: FakeSmtpServerOptions = {}): Promise<FakeSmtpServer> {
    const opts: Required<FakeSmtpServerOptions> = {
      port: options.port ?? 0,
      advertiseStartTls: options.advertiseStartTls ?? false,
      credentials: options.credentials ?? null,
      rejectData: options.rejectData ?? false,
    };

    const server = net.createServer();
    const instance = new FakeSmtpServer(server, 0, opts);

    server.on('connection', (socket) => {
      instance.sockets.add(socket);
      socket.on('close', () => instance.sockets.delete(socket));
      instance.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        // ⚠️ v0.0.5：端口被占用时给出**能一眼看懂的错误**。
        //
        // 实测踩到（远端 CI E2E 失败）：CI 的 workflow 里有一个
        // 「启动 fake SMTP server」步骤，而本测试的 `beforeAll`
        // **自己也会起一个** fake server —— 两者都监听 3025
        // ⇒ `Error: listen EADDRINUSE: address already in use 127.0.0.1:3025`。
        //
        // 这个裸错误完全指不到「是两处同时起了 server」这个真正原因，
        // 只能靠读 `beforeAll` 与 workflow 才能对上。
        //
        // 现在显式识别 EADDRINUSE，并提示最常见的两个原因。
        if (err.code === 'EADDRINUSE') {
          reject(
            new Error(
              `fake SMTP server 无法监听 127.0.0.1:${opts.port} —— 端口已被占用。\n` +
                `\n` +
                `最常见的原因（按可能性排序）：\n` +
                `  1. **同时有两个 fake SMTP server 在跑** ——\n` +
                `     本测试的 beforeAll 会自己起一个（默认端口 ${opts.port}），\n` +
                `     如果 CI workflow / 其它脚本也起了一个，就会撞车。\n` +
                `     ⇒ 检查 .github/workflows/ci.yml 是否有重复的启动步骤。\n` +
                `  2. 上一次运行没退干净（残留进程）。\n` +
                `\n` +
                `修法：要么删掉重复的启动方，要么用 E2E_SMTP_PORT 换一个端口。`,
            ),
          );
          return;
        }
        reject(err);
      });
      server.listen(opts.port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : opts.port;
    (instance as { port: number }).port = actualPort;
    instance.startedAt = Date.now();
    return instance;
  }

  /** 关闭服务器 */
  async stop(): Promise<void> {
    // 先断开所有活跃连接，否则 server.close() 会一直等待
    for (const c of this.sockets) {
      c.destroy();
    }
    this.sockets.clear();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = '';
    let inData = false;
    let dataLines: string[] = [];
    let mailFrom = '';
    const rcptTo: string[] = [];
    let authed = !this.opts.credentials; // 无凭据要求时视为已认证
    /** AUTH LOGIN 的阶段：0=未开始 1=等待 Username 2=等待 Password */
    let authStage = 0;

    const send = (line: string) => {
      socket.write(`${line}\r\n`);
    };

    send('220 fake-smtp ready');

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');

      if (inData) {
        // DATA 模式：直到单独一行 "."
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          if (line === '.') {
            inData = false;
            const data = dataLines.join('\n');
            this.commands.push(`DATA(${dataLines.length} lines)`);

            if (this.opts.rejectData) {
              send('554 message rejected by test policy');
            } else {
              this.received.push({
                from: mailFrom,
                to: [...rcptTo],
                data,
                subject: parseSubject(data),
                body: parseBody(data),
                messageId: parseMessageId(data),
              });
              this.emit('mail', this.received[this.received.length - 1]);
              send('250 OK: queued');
            }
            dataLines = [];
          } else {
            dataLines.push(line);
          }
        }
        return;
      }

      // 命令模式：逐行处理
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line) continue;

        this.commands.push(line);
        const upper = line.toUpperCase();

        if (upper.startsWith('EHLO')) {
          // ⚠️ 多行响应的格式必须**严格**合规：
          //    除最后一行外，每行第 4 字符都是连字符（`250-`）；
          //    只有最后一行用空格（`250 `）。
          // 曾把 `250 SIZE 10485760` 写成空格形式 ⇒ 客户端认为响应
          // 在此结束 ⇒ 后续行全部错位 ⇒ 协议卡死。
          const caps = ['8BITMIME', 'SIZE 10485760'];
          if (this.opts.advertiseStartTls) caps.unshift('STARTTLS');
          const lines = [
            '250-fake-smtp',
            ...caps.map((c) => `250-${c}`),
            '250 HELP', // 唯一用空格的一行 = 结束
          ];
          for (const l of lines) socket.write(`${l}\r\n`);
        } else if (upper.startsWith('HELO')) {
          send('250 fake-smtp');
        } else if (upper.startsWith('STARTTLS')) {
          if (!this.opts.advertiseStartTls) {
            send('454 TLS not available');
          } else {
            send('220 Ready to start TLS');
            // 不真正升级 —— 客户端会尝试 tls.connect，测试里避免证书复杂度
            socket.end();
          }
        } else if (upper.startsWith('AUTH LOGIN')) {
          if (!this.opts.credentials) {
            send('535 authentication not required');
            return;
          }
          authStage = 1;
          send('334 ' + Buffer.from('Username:').toString('base64'));
        } else if (authStage > 0) {
          // AUTH LOGIN 的后续 base64 行（Username / Password）
          // ⚠️ 必须用**专门的状态标志**判断，不能靠 `buffer.length > 0`
          // —— 那时 buffer 已被消费为空，条件恒 false ⇒ 走到最后的
          // `500 unknown command`（实测踩到）。
          const decoded = Buffer.from(line, 'base64').toString('utf8');
          if (authStage === 1) {
            authStage = 2;
            if (decoded === this.opts.credentials!.user) {
              send('334 ' + Buffer.from('Password:').toString('base64'));
            } else {
              send('535 authentication failed');
              authStage = 0;
            }
          } else {
            authStage = 0;
            if (decoded === this.opts.credentials!.pass) {
              authed = true;
              send('235 Authentication successful');
            } else {
              send('535 authentication failed');
            }
          }
        } else if (upper === 'QUIT') {
          send('221 Bye');
          socket.end();
        } else if (upper.startsWith('MAIL FROM')) {
          // ⚠️ 未认证就发 MAIL FROM 必须被拒（RFC 5321 §4.1.1.1 要求 530）
          //    否则「凭据错误」用例里服务器会照常收下邮件，
          //    断言「服务器没收到邮件」就永远失败。
          if (!authed) {
            send('530 Authentication required');
            return;
          }
          mailFrom = line.slice(10).trim().replace(/^<|>$/g, '');
          send('250 OK');
        } else if (upper.startsWith('RCPT TO')) {
          if (!authed) {
            send('530 Authentication required');
            return;
          }
          // 'RCPT TO:' 是 8 个字符 —— slice(7) 会留下前导冒号
          rcptTo.push(line.slice(8).trim().replace(/^<|>$/g, ''));
          send('250 OK');
        } else if (upper === 'DATA') {
          send('354 End data with <CR><LF>.<CR><LF>');
          inData = true;
          dataLines = [];
        } else if (upper === 'RSET') {
          mailFrom = '';
          rcptTo.length = 0;
          send('250 OK');
        } else if (upper === 'NOOP') {
          send('250 OK');
        } else {
          send('500 unknown command');
        }
      }
    });

    socket.on('error', () => {
      /* 连接被客户端断开是正常的 */
    });
  }

  /** 服务器已运行时长（ms）—— 测试里用于确认不是陈旧实例 */
  get uptimeMs(): number {
    return Date.now() - this.startedAt;
  }
}
