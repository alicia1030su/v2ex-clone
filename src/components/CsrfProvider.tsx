'use client';

import { useCallback } from 'react';

/**
 * CSRF token 读取与请求封装（客户端）
 *
 * 双提交 Cookie 模式：CSRF Cookie 是有意设置为非 HttpOnly 的，
 * 这样客户端可以读取并放入请求头。攻击者受同源策略限制无法读取该 Cookie，
 * 因此无法伪造合法请求。
 */

const CSRF_COOKIE = 'v2_csrf';

export function readCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp('(?:^|; )' + CSRF_COOKIE + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

/**
 * 发起带 CSRF token 的写请求。
 * 自动注入 x-csrf-token 头。
 */
export async function csrfFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = readCsrfToken();
  if (token) headers.set('x-csrf-token', token);
  return fetch(input, { ...init, headers });
}

/** 供表单使用：读取 token 的回调 */
export function useCsrfToken(): () => string {
  return useCallback(() => readCsrfToken(), []);
}
