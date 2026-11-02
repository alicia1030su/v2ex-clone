import 'server-only';
import { marked } from 'marked';

/**
 * 内容渲染：Markdown → 安全 HTML
 *
 * 原站正文使用 markdown_body 容器渲染，支持 code/quote/img/表格。
 * 这里用 marked 渲染后做严格清洗，防止 XSS。
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'sup', 'sub',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  code: new Set(['class']),
  pre: new Set(['class']),
  span: new Set(['class']),
  div: new Set(['class']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value: string, allowData: boolean): string | null {
  const trimmed = value.trim().replace(/[-]/g, '');
  if (/^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i.test(trimmed)) return trimmed;
  if (allowData && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * 解析 HTML 字符串，仅保留白名单标签与属性。
 * 采用标签栈扫描，避免依赖 DOM 环境（服务端可用）。
 */
export function sanitizeHtml(html: string): string {
  const out: string[] = [];
  const tagStack: string[] = [];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out.push(escapeHtml(html.slice(i)));
      break;
    }
    if (lt > i) out.push(escapeHtml(html.slice(i, lt)));

    // 注释
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }

    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      out.push(escapeHtml(html.slice(lt)));
      break;
    }

    let tagSrc = html.slice(lt + 1, gt).trim();
    const closing = tagSrc.startsWith('/');
    if (closing) tagSrc = tagSrc.slice(1).trim();
    const selfClosing = tagSrc.endsWith('/');
    if (selfClosing) tagSrc = tagSrc.slice(0, -1).trim();

    const nameMatch = tagSrc.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!nameMatch) {
      out.push(escapeHtml(html.slice(lt, gt + 1)));
      i = gt + 1;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      // 丢弃未知标签，但保留其文本内容
      i = gt + 1;
      continue;
    }

    if (closing) {
      const idx = tagStack.lastIndexOf(tag);
      if (idx !== -1) {
        tagStack.length = idx;
        out.push(`</${tag}>`);
      }
      i = gt + 1;
      continue;
    }

    // 解析属性
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    const attrs: string[] = [];
    let m: RegExpExecArray | null;
    const attrText = tagSrc.slice(nameMatch[0].length);
    while ((m = attrRe.exec(attrText)) !== null) {
      const attrName = m[1].toLowerCase();
      const rawValue = m[3] ?? m[4] ?? m[5] ?? '';
      if (attrName.startsWith('on')) continue; // 事件处理器一律丢弃
      if (attrName === 'style' || attrName === 'srcset') continue;
      const allowed = ALLOWED_ATTRS[tag];
      if (!allowed || !allowed.has(attrName)) continue;
      if (attrName === 'href') {
        const url = safeUrl(rawValue, false);
        if (!url) continue;
        attrs.push(`href="${escapeHtml(url)}"`);
        if (/^https?:/i.test(url)) {
          attrs.push('target="_blank"', 'rel="nofollow noopener noreferrer"');
        }
        continue;
      }
      if (attrName === 'src') {
        const url = safeUrl(rawValue, true);
        if (!url) continue;
        attrs.push(`src="${escapeHtml(url)}"`);
        continue;
      }
      attrs.push(`${attrName}="${escapeHtml(rawValue)}"`);
    }

    out.push(`<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
    if (!selfClosing && !['br', 'hr', 'img'].includes(tag)) {
      tagStack.push(tag);
    }
    i = gt + 1;
  }

  // 关闭未闭合标签
  while (tagStack.length) {
    out.push(`</${tagStack.pop()}>`);
  }
  return out.join('');
}

export async function renderMarkdown(content: string): Promise<string> {
  const raw = await marked.parse(content ?? '', { async: true, gfm: true, breaks: true });
  return sanitizeHtml(String(raw));
}

/** 提取纯文本摘要（用于搜索与描述） */
export function stripHtml(html: string, maxLength = 200): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * 去除 Markdown 标记，返回纯文本摘要。
 * 用于列表页、用户主页等不需要完整 HTML 的场景。
 */
export function stripMarkdown(md: string, maxLength = 200): string {
  const text = (md ?? '')
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * 去除 Markdown 标记，返回纯文本摘要。
 * 用于列表页、用户主页等不需要完整 HTML 的场景。
 */
