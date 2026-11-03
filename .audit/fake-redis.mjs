/**
 * 最小 RESP 服务器（用于验证 ioredis 的运行期断线行为）
 * 支持：PING / AUTH / SELECT / INFO / COMMAND / INCR / EXPIRE / TTL / SET / GET / DEL / FLUSHDB
 * 可通过控制通道（/kill）强制断开所有连接，模拟 Redis 重启/被杀。
 */
import net from 'node:net';

export function startFakeRedis(port = 0) {
  const store = new Map(); // key -> { value, expireAt|null }
  const sockets = new Set();
  let killed = false;

  const encodeSimple = (s) => `+${s}\r\n`;
  const encodeInt = (n) => `:${n}\r\n`;
  const encodeBulk = (s) => (s === null ? '$-1\r\n' : `$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  const encodeErr = (s) => `-ERR ${s}\r\n`;
  const encodeArray = (arr) => `*${arr.length}\r\n` + arr.map((x) => encodeBulk(x)).join('');

  const purge = (k) => {
    const e = store.get(k);
    if (e && e.expireAt && Date.now() > e.expireAt) {
      store.delete(k);
      return undefined;
    }
    return e;
  };

  function handleCommand(args) {
    const cmd = String(args[0] ?? '').toUpperCase();
    switch (cmd) {
      case 'PING':
        return encodeSimple('PONG');
      case 'AUTH':
        return encodeSimple('OK');
      case 'SELECT':
        return encodeSimple('OK');
      case 'INFO':
        return encodeBulk('# Server\r\nredis_version:7.0.0\r\nloading:0\r\n');
      case 'COMMAND':
        return encodeArray([]);
      case 'CLIENT':
        return encodeSimple('OK');
      case 'SET': {
        const key = args[1];
        store.set(key, { value: args[2] ?? '', expireAt: null });
        return encodeSimple('OK');
      }
      case 'GET': {
        const e = purge(args[1]);
        return encodeBulk(e ? e.value : null);
      }
      case 'DEL': {
        let n = 0;
        for (const k of args.slice(1)) if (store.delete(k)) n++;
        return encodeInt(n);
      }
      case 'FLUSHDB':
        store.clear();
        return encodeSimple('OK');
      case 'INCR': {
        const e = purge(args[1]);
        const next = (e ? Number(e.value) : 0) + 1;
        store.set(args[1], { value: String(next), expireAt: e ? e.expireAt : null });
        return encodeInt(next);
      }
      case 'EXPIRE': {
        const e = purge(args[1]);
        if (!e) return encodeInt(0);
        e.expireAt = Date.now() + Number(args[2]) * 1000;
        return encodeInt(1);
      }
      case 'TTL': {
        const e = purge(args[1]);
        if (!e) return encodeInt(-2);
        if (!e.expireAt) return encodeInt(-1);
        return encodeInt(Math.max(0, Math.ceil((e.expireAt - Date.now()) / 1000)));
      }
      case 'PTTL': {
        const e = purge(args[1]);
        if (!e) return encodeInt(-2);
        if (!e.expireAt) return encodeInt(-1);
        return encodeInt(Math.max(0, e.expireAt - Date.now()));
      }
      case 'QUIT':
        return encodeSimple('OK');
      default:
        return encodeErr(`unknown command '${cmd}'`);
    }
  }

  const server = net.createServer((sock) => {
    sockets.add(sock);
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // 解析 RESP 数组
      for (;;) {
        if (buf.length < 4) return;
        if (buf[0] !== 0x2a) {
          // inline command（简单处理）
          const idx = buf.indexOf('\r\n');
          if (idx === -1) return;
          const line = buf.slice(0, idx).toString().trim();
          buf = buf.slice(idx + 2);
          if (line) sock.write(handleCommand(line.split(/\s+/)));
          continue;
        }
        let pos = buf.indexOf('\r\n');
        if (pos === -1) return;
        const count = Number(buf.slice(1, pos).toString());
        let p = pos + 2;
        const args = [];
        let ok = true;
        for (let i = 0; i < count; i++) {
          if (buf[p] !== 0x24) { ok = false; break; }
          const lenPos = buf.indexOf('\r\n', p);
          if (lenPos === -1) { ok = false; break; }
          const len = Number(buf.slice(p + 1, lenPos).toString());
          const start = lenPos + 2;
          if (buf.length < start + len + 2) { ok = false; break; }
          args.push(buf.slice(start, start + len).toString());
          p = start + len + 2;
        }
        if (!ok) return;
        buf = buf.slice(p);
        sock.write(handleCommand(args));
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => sockets.delete(sock));
  });

  return {
    server,
    get port() { return server.address().port; },
    /** 杀掉所有连接（模拟 Redis 重启 / 进程被杀） */
    kill() {
      killed = true;
      for (const s of sockets) {
        try { s.destroy(); } catch { /* ignore */ }
      }
      sockets.clear();
    },
    /** 恢复：重新监听同一端口 */
    async revive() {
      await new Promise((r) => server.listen(server.address().port, '127.0.0.1', r));
      killed = false;
    },
    isKilled: () => killed,
    store,
    async close() {
      for (const s of sockets) { try { s.destroy(); } catch { /* ignore */ } }
      await new Promise((r) => server.close(r));
    },
  };
}
