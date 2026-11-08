import { describe, it, expect } from 'vitest';
import type { Locator, Page, Request } from '@playwright/test';
import { clickUntilRequest } from '../../e2e/helpers';

/**
 * v0.0.12（V10-21）：`clickUntilRequest` 的控制流单测（桩替代浏览器）
 *
 * ## 为什么需要它
 *
 * 该 helper 是为了容忍 Firefox 上偶发的「点击丢失」而引入的：
 * click() 正常返回，但请求从未发出（见 helpers.ts 里的 CI 取证记录）。
 * 浏览器级偶发**无法在单测里稳定复现**，但 helper 的**控制流**
 * （第几轮点击、探针如何注册、全部丢失时是否安静返回）必须被确定性地
 * 验证 —— 否则修了 flake 却引入了「重点两次」或「假装成功」的新缺陷，
 * 比原 flake 更糟。
 *
 * ## 桩的语义
 *
 * `waitForRequest` 的第 N 次调用对应第 N 轮点击的探针：
 * `requestFiresOnClick = k` 表示第 k 轮点击成功发出了请求；
 * `null` 表示每一轮的点击都丢失（请求从未发出）。
 */

interface StubOpts {
  /** 第几轮点击成功发出请求；null = 从不发出 */
  requestFiresOnClick: number | null;
  attempts?: number;
  probeMs?: number;
}

function makeStubs(opts: StubOpts) {
  let clicks = 0;
  let probeRegistrations = 0;

  const locator = {
    click: async () => {
      clicks += 1;
    },
  } as unknown as Locator;

  const page = {
    waitForRequest: (_predicate: (r: Request) => boolean, o: { timeout: number }) => {
      probeRegistrations += 1;
      const round = probeRegistrations;
      const fires = opts.requestFiresOnClick !== null && round >= opts.requestFiresOnClick;
      return new Promise<Request>((resolve, reject) => {
        if (fires) {
          resolve({ method: () => 'POST' } as unknown as Request);
          return;
        }
        // 探针超时 —— 用极小等待，不让单测变慢
        setTimeout(() => reject(new Error('probe timeout')), Math.min(o.timeout, 20));
      });
    },
  } as unknown as Page;

  return {
    locator,
    page,
    getClicks: () => clicks,
    getProbes: () => probeRegistrations,
    opts,
  };
}

const ALWAYS_POST = () => true;

describe('clickUntilRequest（V10-21 点击丢失韧性）', () => {
  it('正常路径：第一轮点击就发出请求 ⇒ 只点一次，不重试', async () => {
    const s = makeStubs({ requestFiresOnClick: 1, probeMs: 20 });
    await clickUntilRequest(s.page, s.locator, ALWAYS_POST, {
      attempts: 3,
      probeMs: 20,
    });
    expect(s.getClicks()).toBe(1);
    expect(s.getProbes()).toBe(1);
  });

  it('丢失后重试：第三轮才发出请求 ⇒ 共点三次后安静返回', async () => {
    const s = makeStubs({ requestFiresOnClick: 3, probeMs: 20 });
    await clickUntilRequest(s.page, s.locator, ALWAYS_POST, {
      attempts: 3,
      probeMs: 20,
    });
    expect(s.getClicks()).toBe(3);
    expect(s.getProbes()).toBe(3);
  });

  it('负向对照：每轮都丢失 ⇒ 点满 attempts 次后返回（不抛错，交给调用方的响应超时失败）', async () => {
    const s = makeStubs({ requestFiresOnClick: null, probeMs: 20 });
    await expect(
      clickUntilRequest(s.page, s.locator, ALWAYS_POST, { attempts: 3, probeMs: 20 }),
    ).resolves.toBeUndefined();
    expect(s.getClicks()).toBe(3);
    expect(s.getProbes()).toBe(3);
  });

  it('attempts 可定制：5 轮预算 ⇒ 全丢失时点满 5 次', async () => {
    const s = makeStubs({ requestFiresOnClick: null, probeMs: 20 });
    await clickUntilRequest(s.page, s.locator, ALWAYS_POST, { attempts: 5, probeMs: 20 });
    expect(s.getClicks()).toBe(5);
  });

  it('默认 attempts 为 3（与 gotoResilient 的范式一致）', async () => {
    const s = makeStubs({ requestFiresOnClick: null, probeMs: 20 });
    await clickUntilRequest(s.page, s.locator, ALWAYS_POST, { probeMs: 20 });
    expect(s.getClicks()).toBe(3);
  });

  it('探针必须在点击之前注册（否则请求与点击同 task 发出时会漏检 ⇒ 假阴性）', async () => {
    // 记录「注册探针」与「点击」的先后顺序：正常路径下第一次注册必须早于第一次点击
    const order: string[] = [];
    const locator = {
      click: async () => {
        order.push('click');
      },
    } as unknown as Locator;
    const page = {
      waitForRequest: () => {
        order.push('probe');
        return Promise.resolve({ method: () => 'POST' } as unknown as Request);
      },
    } as unknown as Page;
    await clickUntilRequest(page, locator, ALWAYS_POST, { probeMs: 20 });
    expect(order).toEqual(['probe', 'click']);
  });
});
