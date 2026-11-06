/**
 * v0.0.6：Windows EPERM 的**最终兜底** —— 文件打开失败自动重试
 *
 * ## 为什么需要它
 *
 * 专项诊断（docs/WINDOWS_EPERM_DIAGNOSIS_v0.0.6.md）已经确认：
 *   · EPERM 发生在 **Next 的 build worker 子进程**里 —— worker 创建
 *     `.next/trace` 时被系统拒绝；
 *   · 手工 Node 对同一文件的**所有**写入路径（同步 openSync / 异步 open /
 *     createWriteStream(append|write) / unlink+create）**全部成功**
 *     ⇒ 不是文件权限、不是 ACL、不是杀毒拦截；
 *   · 同一状态下**同一命令**有时成功、有时 EPERM
 *     ⇒ EPERM 是**瞬时**的（Windows 文件系统过滤/元数据提交的时序问题）。
 *
 * 既然是瞬时的，**正确的兜底就是在打开失败时重试** ——
 * 这比「猜测哪个变量触发的」更普适，也更诚实。
 *
 * ## 用法
 *
 *   NODE_OPTIONS="--require <abs-path>/scripts/ci/next-build-retry.cjs" npx next build
 *
 * 脚本 `run-e2e-locally.sh` / `run-visual-regression.sh` 已自动接入。
 *
 * ## 实现要点
 *
 * · 只对 **EPERM** 重试（其它错误码照常抛出 —— 不掩盖真实缺陷）
 * · 重试间隔递增（100ms → 200ms → 400ms …，最多 8 次 ≈ 1.5s）
 * · 同步 API 用 `Atomics.wait` 阻塞等待（不依赖事件循环）
 * · 异步 API（createWriteStream）用 stream 事件包装，在 error 时重开
 * · 计数写入 `process.env.__EPERM_RETRIES` 便于日志观察
 */
'use strict';

const fs = require('fs');

const MAX_RETRY = 8;
const BASE_DELAY_MS = 100;

let retried = 0;

/** 同步阻塞等待（Atomics.wait 不需要事件循环） */
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

/** 判断是否值得重试：只对 EPERM 重试 */
function isRetryable(err) {
  return err && (err.code === 'EPERM' || err.code === 'EACCES') && err.syscall === 'open';
}

// ---------------------------------------------------------------------------
// 同步 API：fs.openSync
// ---------------------------------------------------------------------------

const origOpenSync = fs.openSync;
fs.openSync = function patchedOpenSync(path, flags, mode) {
  let attempt = 0;
  for (;;) {
    try {
      return origOpenSync.call(fs, path, flags, mode);
    } catch (err) {
      if (!isRetryable(err) || attempt >= MAX_RETRY) throw err;
      attempt += 1;
      retried += 1;
      sleepSync(BASE_DELAY_MS * attempt);
    }
  }
};

// ---------------------------------------------------------------------------
// 异步 API：fs.open
// ---------------------------------------------------------------------------

const origOpen = fs.open;
fs.open = function patchedOpen(path, flags, mode, callback) {
  const cb = typeof mode === 'function' ? mode : callback;
  const m = typeof mode === 'function' ? undefined : mode;

  const attemptOpen = (attempt) => {
    origOpen.call(fs, path, flags, m, (err, fd) => {
      if (!err) return cb(null, fd);
      if (!isRetryable(err) || attempt >= MAX_RETRY) return cb(err);
      attempt += 1;
      retried += 1;
      setTimeout(() => attemptOpen(attempt), BASE_DELAY_MS * attempt);
    });
  };
  attemptOpen(0);
};

// ---------------------------------------------------------------------------
// 异步 API：fs.createWriteStream（Next 写 trace 用的就是它）
// ---------------------------------------------------------------------------

const origCreateWriteStream = fs.createWriteStream;
fs.createWriteStream = function patchedCreateWriteStream(path, options) {
  const opts = options || {};
  const flags = opts.flags || 'w';

  // 首次打开失败 ⇒ 走重试路径；成功则完全沿用原行为
  let fd = null;
  let firstError = null;
  try {
    fd = origOpenSync.call(fs, path, flags);
  } catch (err) {
    firstError = err;
  }

  if (!firstError) {
    // 用已打开的 fd 构造 stream（行为与原生一致）
    const stream = require('stream');
    const ws = new stream.Writable({ write(chunk, enc, cb) { fs.write(fd, chunk, 0, chunk.length, null, cb); } });
    ws.on('finish', () => { try { fs.closeSync(fd); } catch (e) { /* ignore */ } });
    ws.on('close', () => { try { fs.closeSync(fd); } catch (e) { /* ignore */ } });
    // 保持 createWriteStream 的语义：写入 path
    ws.path = path;
    ws.write = ws.write.bind(ws);
    return ws;
  }

  if (!isRetryable(firstError)) {
    // 非 EPERM ⇒ 交回原生处理（原生会异步抛 error 事件）
    return origCreateWriteStream.call(fs, path, opts);
  }

  // EPERM ⇒ 延迟后重开。重试耗尽时**不能在 setTimeout 回调里 throw** ——
  // 那会变成未捕获异常（uncaughtException），进程直接崩溃且栈完全不指向
  // 「是哪个文件打开失败」。正确做法：在占位 stream 上发 error 事件，
  // 让调用方按正常的 stream 错误语义处理（v0.0.7 审计修正）。
  const stream = require('stream');
  const holder = { stream: null, pending: [], lastError: null };
  const attempt = (n) => {
    try {
      const real = origCreateWriteStream.call(fs, path, opts);
      holder.stream = real;
      for (const chunk of holder.pending) real.write(chunk);
      holder.pending.length = 0;
      return real;
    } catch (e) {
      holder.lastError = e;
      if (!isRetryable(e) || n >= MAX_RETRY) {
        // 耗尽或非可重试错误 ⇒ 通知占位 stream 的监听者
        process.nextTick(() => {
          if (holder.destroyed) return;
          holder.emit('error', e);
        });
        return null;
      }
      setTimeout(() => attempt(n + 1), BASE_DELAY_MS * (n + 1));
      return null;
    }
  };
  setTimeout(() => attempt(0), BASE_DELAY_MS);
  const placeholder = new stream.Writable({
    write(chunk, enc, cb) {
      if (holder.stream) holder.stream.write(chunk, enc, cb);
      else {
        holder.pending.push(chunk);
        cb();
      }
    },
    destroy(err, cb) {
      holder.destroyed = true;
      if (holder.stream) holder.stream.destroy(err);
      cb(err);
    },
  });
  // 让 attempt() 能把 error 事件发到占位 stream 上
  holder.emit = placeholder.emit.bind(placeholder);
  return placeholder;
};

process.on('exit', () => {
  if (retried > 0 && process.env.NEXT_EPERM_RETRY_LOG !== '0') {
    try {
      process.stderr.write(`[next-build-retry] 本次进程内 EPERM 重试 ${retried} 次\n`);
    } catch (e) {
      /* ignore */
    }
  }
});
