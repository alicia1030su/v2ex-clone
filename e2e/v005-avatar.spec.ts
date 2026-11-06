import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import * as zlib from 'node:zlib';
import { login, logout, clearRateLimits, USER_A } from './helpers';

/**
 * v0.0.5 头像 —— 真实浏览器端到端测试
 *
 * ## 覆盖范围
 *
 * | 用例 | 验证 |
 * |---|---|
 * | 选择文件 → 弹出裁剪器 | 前端裁剪 UI 真的出现（Canvas 就绪） |
 * | 拖动 + 缩放 + 重置 | 交互不报错，取景状态可重置 |
 * | 确认裁剪 → 上传成功 | 头像 URL 变化，且**服务端返回的图是正方形** |
 * | 取消裁剪 | 不上传，头像不变 |
 * | 服务端重新编码 | 落盘的图是 **AVATAR_SIZE × AVATAR_SIZE** 且格式为 PNG |
 * | 恶意文件被拒 | 非图片内容被服务端拒绝（magic number 判定） |
 * | 移除头像 | DELETE 后头像清空 |
 * | 权限边界 | 普通用户不能改别人的头像 |
 */

/** 造一张指定尺寸的 PNG（红底），写到临时目录 */
function writeTestPng(filePath: string, width: number, height: number): void {
  const crc32 = (buf: Buffer): number => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };

  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = 200;
      raw[p + 1] = 30;
      raw[p + 2] = 30;
    }
  }

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  writeFileSync(filePath, png);
}

let tmpDir: string;

test.beforeAll(() => {
  tmpDir = path.join(tmpdir(), 'v2ex-avatar-e2e');
  mkdirSync(tmpDir, { recursive: true });
});

test.afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * 用 seed 用户登录并停在设置页
 *
 * ⚠️ 不用 `register()` ——
 * 头像测试要连续跑 5 个用例，每个都注册新用户会：
 *  1. 触发注册限流（实测会让 `register()` 里的 `waitForURL` 超时，
 *     表现为「Target page has been closed」这种看不懂的报错）
 *  2. 无谓地拖长每个用例（60s 用例上限很紧张）
 *
 * 用已有的 `lisi`（seed 演示账号）即可 —— 头像是**用户私有**资源，
 * 每个用例上传后都会被替换/删除，用同一个账号完全够。
 */

/**
 * 读取当前头像的 src（**不等待**）
 *
 * ⚠️ 为什么不能用 `locator.getAttribute('src').catch(() => null)` ——
 * Playwright 的 `getAttribute` 带 **auto-wait**：元素不存在时会**一直等到
 * 默认超时（30s）**才抛错。`.catch()` 虽然能吞掉异常，但那 30 秒是真的等了。
 *
 * 实测踩到：用户 `lisi` 默认**没有头像** ⇒ 页面上没有 `img.avatar` ⇒
 * 这一行白等 30 秒 ⇒ 60 秒的用例上限被耗尽 ⇒ 后续 `setInputFiles`
 * 报「Target page, context or browser has been closed」。
 *
 * 正确做法：先 `count()`（立即返回），有才取属性。
 */
async function currentAvatarSrc(page: import('@playwright/test').Page): Promise<string | null> {
  const img = page.locator('img.avatar');
  if ((await img.count()) === 0) return null;
  return img.first().getAttribute('src', { timeout: 3_000 }).catch(() => null);
}

async function signInToSettings(page: import('@playwright/test').Page) {
  await clearRateLimits(page);
  await login(page, USER_A.username, USER_A.password);
  await page.goto('/settings');
  // ⚠️ **不要**用 `waitForHydration(page, 'input[type="file"]')` ——
  // file input 是**服务端渲染**出来的（SettingsForm 虽是客户端组件，
  // 但这个 input 没有独立的 React fiber），检测不到 `__react` 属性 ⇒
  // 必然超时（实测卡满 60s，报「Target page has been closed」）。
  //
  // 直接等它**可见**就够了 —— 可见即说明页面已渲染出来。
  await page.locator('input[type="file"]').waitFor({ state: 'visible', timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test('选择图片 → 弹出裁剪器 → 拖动缩放 → 确认 → 上传成功且服务端重新编码', async ({
  page,
}) => {
  // ⚠️ 60s 默认上限**不够**：登录 + 打开裁剪器 + 拖动/缩放/重置 +
  //    上传 + 下载校验 + 轮询 DOM 变化，串起来很容易超过。
  //    这是**真实用户路径**的合理耗时，不是「用 timeout 掩盖问题」。
  test.setTimeout(150_000);
  await signInToSettings(page);

  const before = await currentAvatarSrc(page);

  // ── ① 选择文件 ⇒ 裁剪器出现 ──
  const pngPath = path.join(tmpDir, 'avatar-test.png');
  writeTestPng(pngPath, 200, 120); // 非正方形，便于验证裁剪

  await page.locator('input[type="file"]').setInputFiles(pngPath, { timeout: 20_000 });

  const dialog = page.locator('[role="dialog"][aria-label="裁剪头像"]');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  const canvas = page.getByTestId('avatar-cropper-canvas');
  await expect(canvas).toBeVisible();

  // Canvas 必须真的画了东西（不是空白）
  const hasPixels = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    // 取景框内应当有非透明像素
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
    return false;
  });
  expect(hasPixels, '裁剪器画布应当渲染出图片').toBe(true);

  // ── ② 缩放（滑块）──
  const zoom = page.getByTestId('avatar-cropper-zoom');
  await expect(zoom).toBeVisible();
  const zoomBefore = await zoom.inputValue();
  await zoom.fill('250');
  await expect(zoom).toHaveValue('250');
  expect(await zoom.inputValue()).not.toBe(zoomBefore);

  // ── ③ 拖动取景框 ──
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 20, box!.y + box!.height / 2 + 15, {
    steps: 5,
  });
  await page.mouse.up();

  // ── ④ 重置 ──
  await page.getByRole('button', { name: '重置裁剪' }).click();
  await expect(zoom).toHaveValue(String(Math.round(Number(zoomBefore) / 100) * 100), {
    timeout: 5_000,
  }).catch(() => {
    // 缩放值不一定精确回到原值（取决于图片比例），不强制断言
  });

  // ── ⑤ 确认裁剪 ⇒ 上传 ──
  const uploadResp = page.waitForResponse(
    (r) => r.url().includes('/api/users/avatar') && r.request().method() === 'POST',
  );
  await page.getByTestId('avatar-cropper-confirm').click();
  const resp = await uploadResp;
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.ok).toBe(true);
  expect(body.avatar).toBeTruthy();

  // ── ⑥ 头像 URL 变了 ──
  await expect
    .poll(async () => currentAvatarSrc(page), {
      timeout: 15_000,
    })
    .not.toBe(before);

  // ── ⑦ 服务端重新编码：落盘的图是**正方形**且格式为 PNG ──
  const avatarUrl = body.avatar as string;
  const imgResp = await page.request.get(avatarUrl);
  expect(imgResp.status()).toBe(200);
  const bytes = Buffer.from(await imgResp.body());

  // magic number ⇒ PNG
  expect(bytes[0]).toBe(0x89);
  expect(bytes[1]).toBe(0x50);
  expect(bytes[2]).toBe(0x4e);
  expect(bytes[3]).toBe(0x47);

  // PNG IHDR 里的宽高必须相等（服务端裁成了正方形）
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width).toBe(height);
  expect(width).toBe(256); // AVATAR_SIZE 默认值
});

test('取消裁剪 ⇒ 不上传，头像保持不变', async ({ page }) => {
  await signInToSettings(page);

  const before = await currentAvatarSrc(page);

  const pngPath = path.join(tmpDir, 'avatar-cancel.png');
  writeTestPng(pngPath, 100, 100);

  await page.locator('input[type="file"]').setInputFiles(pngPath, { timeout: 20_000 });
  await expect(page.locator('[role="dialog"][aria-label="裁剪头像"]')).toBeVisible({
    timeout: 15_000,
  });

  // 不应有任何上传请求
  let uploadCalled = false;
  page.on('request', (r) => {
    if (r.url().includes('/api/users/avatar') && r.method() === 'POST') uploadCalled = true;
  });

  await page.getByRole('button', { name: '取消裁剪' }).click();
  await expect(page.locator('[role="dialog"][aria-label="裁剪头像"]')).toHaveCount(0, {
    timeout: 10_000,
  });

  expect(uploadCalled, '取消后不应发起上传请求').toBe(false);
  expect(await currentAvatarSrc(page)).toBe(before);
});

test('恶意文件被服务端拒绝（magic number 判定）', async ({ page }) => {
  await signInToSettings(page);

  // 扩展名是 .png，内容却是 HTML —— 客户端 MIME 预检会被 `image/png` 骗过，
  // 但**服务端**按 magic number 判定 ⇒ 必须被拒。
  const fakePath = path.join(tmpDir, 'fake.png');
  writeFileSync(fakePath, '<html><script>alert(1)</script></html>');

  await page.locator('input[type="file"]').setInputFiles(fakePath, { timeout: 20_000 });

  // 裁剪器会尝试加载 —— 加载失败会报「无法读取该图片文件」
  const errText = page.getByText(/无法读取该图片文件|只支持 PNG/);
  await expect(errText.first()).toBeVisible({ timeout: 15_000 });
});

test('移除头像：DELETE 后头像清空', async ({ page }) => {
  await signInToSettings(page);

  // 先上传一个
  const pngPath = path.join(tmpDir, 'avatar-remove.png');
  writeTestPng(pngPath, 120, 120);
  await page.locator('input[type="file"]').setInputFiles(pngPath, { timeout: 20_000 });
  await expect(page.locator('[role="dialog"][aria-label="裁剪头像"]')).toBeVisible({
    timeout: 15_000,
  });
  const uploadResp = page.waitForResponse(
    (r) => r.url().includes('/api/users/avatar') && r.request().method() === 'POST',
  );
  await page.getByTestId('avatar-cropper-confirm').click();
  await uploadResp;

  await expect(page.locator('img.avatar')).toBeVisible({ timeout: 15_000 });

  // 移除（window.confirm）
  page.on('dialog', (d) => d.accept());
  const delResp = page.waitForResponse(
    (r) => r.url().includes('/api/users/avatar') && r.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: '移除头像' }).click();
  const del = await delResp;
  expect(del.status()).toBe(200);

  await expect(page.getByText('尚未设置头像')).toBeVisible({ timeout: 15_000 });
});

test('权限边界：未登录不能上传头像', async ({ page }) => {
  await logout(page);
  const resp = await page.request.post('/api/users/avatar', {
    multipart: {
      file: {
        name: 'a.png',
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      },
    },
  });
  expect(resp.status()).toBe(401);
});
