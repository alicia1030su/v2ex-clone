import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getKV } from '@/lib/kv';

/**
 * 验证码服务端逻辑
 *
 * 原站在登录页使用 /_captcha 返回 320x80 的验证码图片，
 * 输入框字段名为一次性哈希，另有 once 隐藏字段。
 *
 * 本项目实现等效机制（服务端生成、自持校验，不依赖原站）：
 *  - 答案存放在服务端 KV（Redis / PostgreSQL 降级），不放在客户端
 *  - 一次性使用，校验后立即作废
 */
export const CAPTCHA_TTL_SECONDS = 300;
export const CAPTCHA_LENGTH = 4;

/** 字段名用一次性哈希，与原站做法一致 */
export function captchaFieldName(challengeId: string): string {
  return createHash('sha256').update(`captcha:${challengeId}:field`).digest('hex');
}

export function randomCaptchaText(): string {
  // 排除易混淆字符（0/O、1/I/l）
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = randomBytes(CAPTCHA_LENGTH * 2);
  for (let i = 0; i < CAPTCHA_LENGTH; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function captchaAnswerHash(challengeId: string, text: string): string {
  return createHash('sha256').update(`captcha:${challengeId}:${text}`).digest('hex');
}

/** 画一个 320x80 的 SVG 验证码，避免依赖 canvas 原生模块 */
export function renderCaptchaSvg(text: string): string {
  const w = 320;
  const h = 80;
  const chars = text.split('');
  const cellW = w / chars.length;

  const noise: string[] = [];
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    const r = Math.random() * 1.6 + 0.3;
    const o = (Math.random() * 0.5 + 0.2).toFixed(2);
    noise.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`);
  }

  const glyphs = chars
    .map((c, i) => {
      const x = cellW * i + cellW / 2;
      const y = h / 2 + (Math.random() * 12 - 6);
      const rot = Math.floor(Math.random() * 50 - 25);
      const size = 36 + Math.floor(Math.random() * 10);
      const color = `hsl(${Math.floor(Math.random() * 360)}, 70%, ${Math.floor(
        Math.random() * 30 + 40,
      )}%)`;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" font-family="Georgia, serif" font-weight="bold" fill="${color}" text-anchor="middle" transform="rotate(${rot} ${x.toFixed(
        1,
      )} ${y.toFixed(1)})">${c}</text>`;
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#1a1a1a"/>
${noise.join('')}
${glyphs}
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * 创建挑战：生成 id、答案哈希与图片，并写入服务端存储。
 * 答案只以哈希形式落库，图片中才包含明文。
 */
export async function createCaptcha(): Promise<{
  id: string;
  image: string;
}> {
  const text = randomCaptchaText();
  const id = randomBytes(16).toString('hex');
  const answerHash = captchaAnswerHash(id, text);
  const kv = await getKV();
  await kv.set(`captcha:${id}`, answerHash, CAPTCHA_TTL_SECONDS);
  return { id, image: renderCaptchaSvg(text) };
}

/** 校验验证码答案：一次性使用 */
export async function verifyCaptcha(challengeId: string, answer: string): Promise<boolean> {
  if (!challengeId || !answer) return false;
  const kv = await getKV();
  const stored = await kv.get(`captcha:${challengeId}`);
  if (!stored) return false;
  await kv.del(`captcha:${challengeId}`);
  const candidate = captchaAnswerHash(challengeId, answer.trim().toUpperCase());
  return candidate === stored;
}

/** 字段名校验：确保提交的字段名与 challenge 匹配 */
export async function verifyCaptchaField(
  challengeId: string,
  fieldName: string,
): Promise<boolean> {
  return fieldName === captchaFieldName(challengeId);
}
