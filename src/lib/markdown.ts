import 'server-only';
import { marked } from 'marked';
import sanitizeHtmlLib from 'sanitize-html';

/**
 * 内容渲染：Markdown → 安全 HTML
 *
 * 原站正文使用 markdown_body 容器渲染，支持 code/quote/img/表格。
 *
 * 安全实现说明（安全审计后修复）：
 *  - 清洗器由自研手写解析器改为成熟方案 `sanitize-html`（2.18.x）。
 *    自研版本存在多处缺陷：
 *      1. URL 过滤正则 `[-]` 实为字面量连字符，未能剥离控制字符，
 *         `java\tscript:` 这类绕过可生效；
 *      2. 允许 `data:image/svg+xml;base64,`，而 SVG 内可嵌 <script>；
 *      3. 允许 <a target> 但未强制 rel，存在 tabnabbing；
 *      4. 注释与畸形标签的处理不完整。
 *    sanitize-html 使用成熟的 htmlparser2 解析 + 事件级过滤，覆盖畸形 HTML、
 *    编码绕过、协议混淆等已知攻击面，且无原生依赖、可在服务端直接运行。
 *
 *  - Markdown 渲染后立即清洗，清洗结果再交给 React 的 dangerouslySetInnerHTML。
 *    组件层不做二次拼接，避免"清洗后又被拼接回去"。
 */

/** 允许的标签（对齐原站 markdown_body 支持的子集） */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'sup', 'sub',
];

/** 允许的属性 */
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  code: ['class'],
  pre: ['class'],
  span: ['class'],
  div: ['class'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
};

/**
 * 允许的 URL 协议。
 *
 * 注意：明确**不包含** `data:` —— 即便是 data:image，
 * `data:image/svg+xml` 也能内嵌脚本，会造成 XSS。
 * 图片使用 http/https/相对路径即可覆盖真实需求。
 */
const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'];

/**
 * 清洗 HTML。
 *
 * @param html 待清洗的 HTML 片段
 * @param opts.allowDataImage 是否允许 data:image（默认不允许）
 */
export function sanitizeHtml(html: string, opts: { allowDataImage?: boolean } = {}): string {
  return sanitizeHtmlLib(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    // 协议白名单同时作用于 href 与 src。
    // 注意：不要再设置 allowedSchemesByTag —— 与 allowedSchemesAppliedToAttributes
    // 组合会让 sanitize-html 在处理属性时拿到 null 的 scheme 集合并抛错。
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    // 过滤 style 属性，杜绝 CSS 注入（expression / url() 外联）
    allowedStyles: undefined,
    disallowedTagsMode: 'discard',
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'applet', 'template', 'link', 'meta', 'base', 'form'],
    transformTags: {
      // 外链一律加 noopener，防止 tabnabbing
      a: (tagName, attribs) => {
        const href = attribs.href ?? '';
        const isExternal = /^https?:\/\//i.test(href);
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(isExternal ? { target: '_blank', rel: 'nofollow noopener noreferrer' } : {}),
            ...(attribs.target === '_blank' && !isExternal
              ? { rel: 'nofollow noopener noreferrer' }
              : {}),
          },
        };
      },
      // 图片补 alt 与 loading，避免布局抖动与无障碍缺陷
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, alt: attribs.alt ?? '', loading: 'lazy' },
      }),
    },
  });
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
