import { NextResponse } from 'next/server';
import { createCaptcha, captchaFieldName } from '@/server/captcha';

export const dynamic = 'force-dynamic';

/**
 * 验证码端点
 * 返回 { image: <data-uri>, id: <challenge-id>, field: <字段名> }
 */
export async function GET() {
  const { id, image } = await createCaptcha();
  return NextResponse.json({
    ok: true,
    id,
    field: captchaFieldName(id),
    image,
    placeholder: '请输入上图中的验证码，点击可以更换图片',
  });
}
