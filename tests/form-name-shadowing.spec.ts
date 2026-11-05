import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './helpers/local-bin';

/**
 * 表单命名控件遮蔽回归测试（v0.0.4 · V4-20 / R-27）
 *
 * ## 这个测试在防什么
 *
 * HTML 规范给 `HTMLFormElement` 加了 `[OverrideBuiltins]`：
 * **表单内的命名控件**会通过「命名属性访问」遮蔽原型上的同名属性。
 *
 *     <form><input name="nodeName"></form>
 *
 * 此时在 JS 里：
 *
 *     form.nodeName   // → HTMLInputElement（不是字符串 "FORM"）
 *
 * 而 Next.js 15.5 内置的 React 19 水合代码里有这一行
 * （`react-dom-client.production.js` 的 `canHydrateInstance`）：
 *
 *     instance.nodeName.toLowerCase() !== type.toLowerCase()
 *
 * `nodeName` 此时是 Element → `.toLowerCase()` 不存在 → 抛
 * `TypeError: nodeName.toLowerCase is not a function` →
 * React 水合失败（**error #418**）→ **事件处理器不绑定** →
 * 表单走浏览器原生 GET 提交 → 写操作彻底失效。
 *
 * ## 真实事故（v0.0.4 CI 唯一红灯）
 *
 * `src/components/NodeRequestForm.tsx` 里的 `<input name="nodeName">`
 * 让 `/nodes/request` 的「提交申请」按钮**完全无法工作**：
 * E2E `e2e/v004-four-roles-ui.spec.ts:122` 红了，
 * 而走 API 的同链路用例是绿的（说明后端没问题，是纯前端缺陷）。
 *
 * ## 本地实测（Chromium，2026-11-05）
 *
 * | form 内 input 的 name | `form.<name>` 的类型 | `.toLowerCase()` |
 * |---|---|---|
 * | `nodeName` | object（HTMLInputElement） | ❌ TypeError |
 * | `title`    | object（HTMLInputElement） | ❌ TypeError |
 * | `id`       | object（HTMLInputElement） | ❌ TypeError |
 * | `action`   | object（HTMLInputElement） | ❌ TypeError |
 * | `nodeTitle`| string | ✅ |
 *
 * `nodeName` 是**唯一直接触发 react-dom 崩溃**的那个
 * （react-dom 的水合代码只调 `instance.nodeName.toLowerCase()`），
 * 但 `title` / `id` / `action` 同样被遮蔽，属于同类隐患 —— 一并守住。
 */

/**
 * ⛔ **致命**属性：遮蔽后会让 react-dom 的水合代码**直接崩溃**
 *
 * react-dom 19 的 `canHydrateInstance` 只有这一处会读元素的 DOM 属性：
 *
 *     instance.nodeName.toLowerCase() !== type.toLowerCase()
 *
 * `instance.nodeName` 一旦被表单控件遮蔽（变成 Element 而非字符串），
 * `.toLowerCase()` 就不存在 → `TypeError` → 水合失败（error #418）→
 * 事件处理器不绑定 → 表单走浏览器原生 GET 提交 → 写操作彻底失效。
 *
 * 本地实测（Chromium 2026-11-05）：
 *   `<form><input name="nodeName"></form>` → form.nodeName 是 HTMLInputElement
 *   `<form><input id="nodeName"></form>`    → 同上（**id 也会遮蔽**！）
 */
const FATAL_FORM_PROPERTIES = ['nodeName'] as const;

/**
 * ⚠️ **隐患**属性：遮蔽后不直接让 react-dom 崩溃，但会破坏 DOM 语义
 *
 * 实测结论（Chromium 2026-11-05）：
 *   `name="title"` / `id="title"` → `form.title` 变成 HTMLInputElement，
 *   但 `form.nodeName` 仍返回 "FORM" → **react-dom 不崩**。
 *
 * 因此这一档不作为「红灯」，但仍记录下来 —— 它们会让
 * `form.title` / `form.id` 之类的读取拿到错误类型，
 * 将来若有库访问这些属性就会踩坑。
 *
 * 注意：`id="title"` 在本仓库里是**保留**的（E2E 用 `#title` 定位），
 * 只把 `name="title"` 改名。`name` 与 `id` 的差别就在这里。
 */
const RISKY_FORM_PROPERTIES = [
  // HTMLFormElement 自身的 IDL 属性
  'acceptCharset',
  'action',
  'autocomplete',
  'enctype',
  'encoding',
  'method',
  'name',
  'noValidate',
  'target',
  'rel',
  'relList',
  'elements',
  'length',
  // HTMLElement
  'id',
  'title',
  'lang',
  'dir',
  'hidden',
  'innerText',
  'outerText',
  'className',
  'classList',
  'slot',
  // Node
  'nodeName',
  'nodeValue',
  'nodeType',
  'nodeType',
  'textContent',
  'localName',
  'namespaceURI',
  'tagName',
  'childNodes',
  'children',
  'firstChild',
  'lastChild',
  'parentNode',
  'parentElement',
  'nextSibling',
  'previousSibling',
  'nextElementSibling',
  'previousElementSibling',
  'firstElementChild',
  'lastElementChild',
  'childElementCount',
  'attributes',
  'ownerDocument',
  'ownerWindow',
  'isConnected',
  'innerHTML',
  'outerHTML',
] as const;

/** 收集 src/ 下所有 .tsx / .ts 文件 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 提取一个文件里所有 `name="xxx"` / `id="xxx"` 字面量及其行号
 *
 * ⚠️ **`name` 与 `id` 都会触发遮蔽** —— 这是本轮实测踩到的关键坑：
 * 最初只改了 `name`，把 `id="nodeName"` 留下来，结果**崩溃照旧**。
 * HTML 规范的 `HTMLFormElement` 命名属性访问同时覆盖表单控件的
 * `name` **和** `id`（两者都会把控件「暴露」成 form 的命名属性）。
 *
 * ⚠️ **必须跳过注释** —— 说明性注释里会**引用**
 * `name="nodeName"` 这类字面量来解释问题本身（那是注释，不是真实属性）。
 * 若不过滤，测试会把自己的注释当成违规 → 永远红。
 *
 * 做法：逐行剔除
 *   - 块注释 `/* ... *\/`（跨行）
 *   - 行注释 `// ...`
 *   - JSX 注释 `{/* ... *\/}`（与块注释同形，已覆盖）
 * 然后再在**剩余的代码文本**里做正则匹配。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * 提取一个文件里所有 `name="xxx"` / `id="xxx"` 字面量及其行号（跳过注释）
 *
 * 只统计**表单控件**上的 name / id —— 本测试关注的是
 * 「表单内控件的命名属性遮蔽 form 的 DOM 属性」这一类问题。
 */
function extractControlAttributes(
  source: string,
): Array<{ attr: 'name' | 'id'; name: string; line: number }> {
  const hits: Array<{ attr: 'name' | 'id'; name: string; line: number }> = [];
  const code = stripComments(source);

  // 先按标签切开，只在 input / select / textarea / button / output 内部找 name / id
  const tagRe = /<(input|select|textarea|button|output)\b([^>]*)>/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(code)) !== null) {
    const attrs = tag[2];
    const attrRe = /\b(name|id)=["']([^"']+)["']/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(attrs)) !== null) {
      hits.push({
        attr: a[1] as 'name' | 'id',
        name: a[2],
        line: code.slice(0, tag.index).split('\n').length,
      });
    }
  }
  return hits;
}

describe('表单命名控件遮蔽防护（V4-20 / R-27）', () => {
  it('src/ 下没有任何表单控件的 name / id 与 form.nodeName 同名（致命项）', () => {
    const files = collectSourceFiles(path.join(repoRoot, 'src'));
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const hit of extractControlAttributes(source)) {
        if ((FATAL_FORM_PROPERTIES as readonly string[]).includes(hit.name)) {
          const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
          violations.push(
            `${rel}:${hit.line} → name/id="${hit.name}" 遮蔽 form.nodeName ` +
              `（HTMLFormElement [OverrideBuiltins]）→ React 水合会抛 ` +
              `TypeError: nodeName.toLowerCase is not a function`,
          );
        }
      }
    }

    expect(
      violations,
      '发现遮蔽 form.nodeName 的表单控件（name 与 id 都会遮蔽！）：\n' + violations.join('\n'),
    ).toEqual([]);
  });

  it('危险属性只允许出现在「已知的、实测不致命」的位置', () => {
    // `name="title"` 会遮蔽 form.title（实测不致命，但仍是隐患）→ 必须改名
    // `id="title"` 同样遮蔽 form.title，但 E2E 用 `#title` 定位 → 保留
    // 本测试锁住这个约定：将来若有人把 id 也改掉，E2E 会红
    const files = collectSourceFiles(path.join(repoRoot, 'src'));
    const risky: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const hit of extractControlAttributes(source)) {
        if (!(RISKY_FORM_PROPERTIES as readonly string[]).includes(hit.name)) continue;
        const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
        // id="title" 是已知且被 E2E 依赖的例外
        if (hit.attr === 'id' && hit.name === 'title') continue;
        risky.push(`${rel}:${hit.line} → ${hit.attr}="${hit.name}" 遮蔽 form.${hit.name}`);
      }
    }
    expect(
      risky,
      '发现遮蔽 DOM 语义属性的表单控件（name 侧）：\n' + risky.join('\n'),
    ).toEqual([]);
  });

  it('NodeRequestForm 的节点名输入框使用 id 而非 name 定位（回归锚点）', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src/components/NodeRequestForm.tsx'),
      'utf8',
    );
    // 断言只在**代码**里看（注释里会引用这些字面量来解释问题本身）
    const code = stripComments(source);

    // 必须存在 id="node_slug"（E2E 与样式依赖它）
    expect(code).toContain('id="node_slug"');
    // 绝不能再出现 name="nodeName" 或 id="nodeName"
    // （这是 v0.0.4 CI 唯一红灯的根因；**两者都会遮蔽**，改一个不够）
    expect(code).not.toContain('name="nodeName"');
    expect(code).not.toContain('id="nodeName"');
    // name 必须是改名后的安全值
    expect(code).toContain('name="node_slug"');
  });

  it('已修复的两个同源隐患点的 name 也已改名（NewTopicForm / TopicEditForm）', () => {
    for (const rel of [
      'src/components/NewTopicForm.tsx',
      'src/components/TopicEditForm.tsx',
    ]) {
      const source = readFileSync(path.join(repoRoot, rel), 'utf8');
      const code = stripComments(source);
      // name 侧必须改名（遮蔽 form.title）
      expect(code, `${rel} 仍存在 name="title"`).not.toContain('name="title"');
    }
    // NewTopicForm 的 id="title" 是**有意保留**的（E2E 用 #title 定位）
    const ntf = stripComments(
      readFileSync(path.join(repoRoot, 'src/components/NewTopicForm.tsx'), 'utf8'),
    );
    expect(ntf).toContain('id="title"');
    expect(ntf).toContain('name="topic_title"');
  });
});
