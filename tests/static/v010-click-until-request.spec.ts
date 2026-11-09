import { describe, it, expect } from 'vitest';
import type { Locator, Page, Request } from '@playwright/test';
import { clickUntilRequest, WRITE_CLICK_RETRY } from '../../e2e/helpers';

/**
 * `clickUntilRequest` 控制流单测（桩替代浏览器）
 *
 * ## v0.0.12（V10-21）原始目标
 * 容忍 Firefox 偶发「点击丢失」：click() 正常返回，但请求从未发出。
 *
 * ## v0.0.13（V13-05）新增目标：**不能因为修 flake 而制造重复提交**
 *
 * 旧实现每轮「探针超时就再点一次」，最多 3 次。对发帖 / 回复 / 消费积分 /
 * 注册 / 重置密码这类**非幂等写操作**，只要窄探针漏检了实际已发出的请求，
 * 第二次点击就会真的重复执行一次写操作。本轮加入三道闸门：
 *
 *   ① 宽请求监听**先于**第一次点击注册
 *   ② 观察到任何写请求 ⇒ 不再点
 *   ③ 有在途请求 / 按钮进入 pending 态 ⇒ 不再点
 *
 * 并且**写操作默认只点一次**；要容忍点击丢失必须显式
 * `allowWriteRetry: true`（`WRITE_CLICK_RETRY`）。本文件的负向对照
 * 逐条验证「已发出请求」「在途」「pending」「默认写操作」四种情形
 * 下点击次数恒为 1。
 */

type StubOpts = {
  /** 第几轮起窄探针能看到请求；null = 永远看不到 */
  narrowFiresOnRound?: number | null;
  /** 第几轮点击时由宽监听捕获一个写请求（窄探针仍看不到） */
  broadEmitOnRound?: number | null;
  /** 宽监听捕获的请求是否一直保持在途（不触发 requestfinished） */
  keepInFlight?: boolean;
  /** 第一次点击后按钮进入 disabled/pending */
  pendingAfterClick?: boolean;
  attempts?: number;
  probeMs?: number;
};

type Handler = (r: Request) => void;

function makeStubs(opts: StubOpts = {}) {
  let clicks = 0;
  let probeRegistrations = 0;
  let listenersOn = 0;
  let listenersOff = 0;
  const order: string[] = [];
  const handlers: Record<string, Handler[]> = {
    request: [],
    requestfinished: [],
    requestfailed: [],
  };

  const req = (url: string, method: string) =>
    ({ url: () => url, method: () => method, resourceType: () => 'fetch' }) as unknown as Request;

  const emit = (event: string, r: Request) => {
    for (const h of handlers[event] ?? []) h(r);
  };

  const page = {
    on: (event: string, h: Handler) => {
      (handlers[event] ??= []).push(h);
      listenersOn += 1;
      if (event === 'request') order.push('listener');
      return page;
    },
    off: (event: string, h: Handler) => {
      handlers[event] = (handlers[event] ?? []).filter((x) => x !== h);
      listenersOff += 1;
      return page;
    },
    waitForRequest: (predicate: (r: Request) => boolean, o: { timeout: number }) => {
      probeRegistrations += 1;
      const round = probeRegistrations;
      order.push('probe');
      // 桩里让 predicate 参与判定，确保「窄探针」语义真实生效
      const candidate = req('/api/other', 'POST');
      const fires =
        opts.narrowFiresOnRound != null &&
        round >= opts.narrowFiresOnRound &&
        predicate(candidate);
      return new Promise<Request>((resolve, reject) => {
        if (fires) return resolve(candidate);
        setTimeout(() => reject(new Error('probe timeout')), Math.min(o.timeout, 15));
      });
    },
  } as unknown as Page;

  const locator = {
    click: async () => {
      clicks += 1;
      order.push('click');
      if (opts.broadEmitOnRound != null && clicks >= opts.broadEmitOnRound) {
        const r = req('/api/topics', 'POST');
        emit('request', r);
        if (!opts.keepInFlight) emit('requestfinished', r);
      }
    },
    isDisabled: async () => Boolean(opts.pendingAfterClick && clicks > 0),
    getAttribute: async () => null,
    textContent: async () => '提交',
  } as unknown as Locator;

  return {
    page,
    locator,
    emit,
    req,
    getClicks: () => clicks,
    getProbes: () => probeRegistrations,
    getListenersOn: () => listenersOn,
    getListenersOff: () => listenersOff,
    order,
  };
}

/** 只匹配 /api/topics 的窄谓词；宽监听发出的 /api/other 故意不匹配 */
const NARROW = (r: Request) => r.url().includes('/api/topics') && r.method() === 'POST';
const ALWAYS = () => true;

describe('clickUntilRequest — 幂等操作（GET / 只读，允许重试）', () => {
  it('正常路径：第一轮就发出请求 ⇒ 只点一次', async () => {
    const s = makeStubs({ narrowFiresOnRound: 1, probeMs: 15 });
    await clickUntilRequest(s.page, s.locator, ALWAYS, { idempotent: true, attempts: 3, probeMs: 15 });
    expect(s.getClicks()).toBe(1);
    expect(s.getProbes()).toBe(1);
  });

  it('点击丢失后重试：第三轮才发出请求 ⇒ 共点三次', async () => {
    const s = makeStubs({ narrowFiresOnRound: 3, probeMs: 15 });
    await clickUntilRequest(s.page, s.locator, ALWAYS, { idempotent: true, attempts: 3, probeMs: 15 });
    expect(s.getClicks()).toBe(3);
    expect(s.getProbes()).toBe(3);
  });

  it('全丢失：点满 attempts 后安静返回（交还调用方的响应等待）', async () => {
    const s = makeStubs({ narrowFiresOnRound: null, probeMs: 15 });
    await expect(
      clickUntilRequest(s.page, s.locator, ALWAYS, { idempotent: true, attempts: 5, probeMs: 15 }),
    ).resolves.toBeUndefined();
    expect(s.getClicks()).toBe(5);
  });

  it('默认 attempts = 3', async () => {
    const s = makeStubs({ narrowFiresOnRound: null, probeMs: 15 });
    await clickUntilRequest(s.page, s.locator, ALWAYS, { idempotent: true, probeMs: 15 });
    expect(s.getClicks()).toBe(3);
  });
});

describe('clickUntilRequest — 非幂等写操作（防重复提交）', () => {
  it('负向①：默认（无 allowWriteRetry）只点一次，丢失时显式抛错', async () => {
    const s = makeStubs({ narrowFiresOnRound: null, probeMs: 15 });
    await expect(
      clickUntilRequest(s.page, s.locator, ALWAYS, { probeMs: 15 }),
    ).rejects.toThrow(/拒绝重试/);
    expect(s.getClicks()).toBe(1);
    expect(s.getProbes()).toBe(1);
  });

  it('负向②：宽监听看到已发出的写请求（窄探针漏检）⇒ 绝不点第二次', async () => {
    const s = makeStubs({
      narrowFiresOnRound: null,
      broadEmitOnRound: 1,
      probeMs: 15,
    });
    await clickUntilRequest(s.page, s.locator, NARROW, {
      ...WRITE_CLICK_RETRY,
      probeMs: 15,
    });
    expect(s.getClicks()).toBe(1);
  });

  it('负向③：请求仍在途 ⇒ 绝不点第二次', async () => {
    const s = makeStubs({
      narrowFiresOnRound: null,
      broadEmitOnRound: 1,
      keepInFlight: true,
      probeMs: 15,
    });
    await clickUntilRequest(s.page, s.locator, NARROW, {
      ...WRITE_CLICK_RETRY,
      probeMs: 15,
    });
    expect(s.getClicks()).toBe(1);
  });

  it('负向④：按钮已进 pending（disabled）⇒ 绝不点第二次', async () => {
    const s = makeStubs({
      narrowFiresOnRound: null,
      pendingAfterClick: true,
      probeMs: 15,
    });
    await clickUntilRequest(s.page, s.locator, ALWAYS, {
      ...WRITE_CLICK_RETRY,
      probeMs: 15,
    });
    expect(s.getClicks()).toBe(1);
  });

  it('负向⑤：三道闸门全过也只允许有限重试，且全丢失时显式抛错', async () => {
    const s = makeStubs({ narrowFiresOnRound: null, probeMs: 15 });
    await expect(
      clickUntilRequest(s.page, s.locator, ALWAYS, { ...WRITE_CLICK_RETRY, probeMs: 15 }),
    ).rejects.toThrow(/均未被观察到|均未观察到请求/);
    expect(s.getClicks()).toBe(3);
  });

  it('正向：真正零请求、零在途、零 pending 时才允许重试，第二轮成功', async () => {
    const s = makeStubs({ narrowFiresOnRound: 2, probeMs: 15 });
    await clickUntilRequest(s.page, s.locator, ALWAYS, { ...WRITE_CLICK_RETRY, probeMs: 15 });
    expect(s.getClicks()).toBe(2);
  });

  it('宽监听先于第一次点击注册，且调用结束后被移除', async () => {
    const s = makeStubs({ narrowFiresOnRound: 1, probeMs: 15 });
    await clickUntilRequest(s.page, s.locator, ALWAYS, { idempotent: true, probeMs: 15 });
    expect(s.order.slice(0, 3)).toEqual(['listener', 'probe', 'click']);
    expect(s.getListenersOff()).toBe(s.getListenersOn());
  });

  it('窄探针必须先于点击注册（请求与点击同 task 发出，先点后注册会漏检）', async () => {
    const s = makeStubs({ narrowFiresOnRound: 1, probeMs: 15 });
    await clickUntilRequest(s.page, s.locator, ALWAYS, { idempotent: true, probeMs: 15 });
    expect(s.order.indexOf('probe')).toBeLessThan(s.order.indexOf('click'));
  });
});
