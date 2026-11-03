import 'server-only';

/**
 * 运行时开关的集中判定
 *
 * 安全要求：
 *  - `DISABLE_CAPTCHA` 只能在与生产无关的隔离测试环境生效。
 *    仅当 NODE_ENV === 'test'（或显式 TEST_ENV 标记）时才允许，
 *    生产/预发环境即使误配该变量也必须强制启用验证码。
 *  - `ENABLE_DEBUG_ENDPOINTS` 同样受限，并且调试端点还需要单独的管理令牌。
 */

export type RuntimeEnv = 'production' | 'staging' | 'test' | 'development';

export function getRuntimeEnv(): RuntimeEnv {
  const explicit = process.env.APP_RUNTIME_ENV?.toLowerCase();
  if (explicit === 'production' || explicit === 'staging' || explicit === 'test') {
    return explicit;
  }
  if (process.env.NODE_ENV === 'production') return 'production';
  if (process.env.NODE_ENV === 'test') return 'test';
  if (process.env.NODE_ENV === 'development') return 'development';
  return 'production';
}

/** 是否为可关闭安全机制的隔离测试环境 */
export function isIsolatedTestEnv(): boolean {
  if (getRuntimeEnv() !== 'test') return false;
  // 必须显式标记，防止误把普通开发环境当成测试环境
  return process.env.TEST_ENV_ISOLATED === '1';
}

/**
 * 验证码是否可被跳过。
 *
 * 仅在**隔离测试环境**（APP_RUNTIME_ENV=test 且 TEST_ENV_ISOLATED=1）中允许。
 * 生产与预发环境一律强制验证码。
 */
export function isCaptchaDisabled(): boolean {
  if (process.env.DISABLE_CAPTCHA !== '1') return false;
  return isIsolatedTestEnv();
}

/** 调试端点是否可访问（还需额外通过令牌校验） */
export function isDebugEndpointEnabled(): boolean {
  if (process.env.ENABLE_DEBUG_ENDPOINTS !== '1') return false;
  // 调试端点在任何环境都允许开启，但必须配合令牌鉴权
  return true;
}

/** 调试端点访问令牌（未配置时返回 null，即拒绝访问） */
export function getDebugToken(): string | null {
  const token = process.env.DEBUG_ENDPOINT_TOKEN?.trim();
  return token ? token : null;
}
