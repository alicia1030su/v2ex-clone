import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 标签链路**可达性**护栏（v0.0.14）
 *
 * ## 这个护栏防的是什么
 *
 * 加标签功能之前，本项目存在一个很隐蔽的缺口：
 *
 *   · `tags` / `topic_tags` 表 —— 在 schema 里（v0.0.1 起）；
 *   · 主题页标签渲染 —— 有（`innerJoin(topic_tags)`）；
 *   · `/tag/[name]` 页面 —— 有，且是可用路由；
 *   · **生产代码写入** —— **零**（只有 `scripts/loadtest/seed-large.ts` 写）。
 *
 * 也就是说：页面齐全、表格齐全、渲染齐全，但**没有一条路径能让数据进去**。
 * 静态护栏当时只检查「页面存在」「表存在」，于是全绿；这类缺口叫
 * 「代码齐全、链路不通」，是「按目录清单验收」必然漏掉的一类。
 *
 * 本护栏因此**不看文件是否存在**，只看**写入链路是否真的接上**：
 * ① 发帖路由必须调用标签写入；
 * ② 编辑路由必须调用标签写入（且是追加语义，不是覆盖）；
 * ③ 标签写入必须走唯一实现（禁止各写一份）；
 * ④ 规范化必须是小写 + 去重 + 上限（否则会分裂标签、造 404 链接）。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/**
 * 去掉注释，只留真实代码。
 *
 * ⚠️ 本仓反复踩过「护栏用朴素字符串匹配，把注释里的说明当成实现」的坑
 * （V13-17 的 `not.toContain("from '@/db'")` 被注释误伤、本文件第一版的
 * `not.toContain('localeCompare')` 被「刻意不用 localeCompare」这句注释误伤）。
 * 凡是「不得出现某写法」这类反向断言，都必须先剥注释。
 */
const codeOnly = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（不误伤 https://）

describe('标签写入链路必须真实接上（不是「表存在」就算实现）', () => {
  it('发帖路由**真的调用** attachTags（不是只 import 进来）', () => {
    const route = codeOnly(read('src/app/api/topics/route.ts'));
    // ⚠️ 这里必须匹配**调用形态**而不是名字：第一版只查 `toContain('attachTags')`，
    //    而 import 语句本身就满足了这个条件 ⇒ 把调用改成 `appliedTags = []`
    //    护栏依然全绿（负向对照实测发现）。「名字出现」不等于「真的被调用」。
    expect(route, 'POST /api/topics 必须实际调用标签写入').toMatch(
      /attachTags\(\s*topic\.id\s*,/,
    );
    expect(route, '必须把规范化后的标签回显（否则前端无法确认）').toContain('tags: appliedTags');
    // 标签写入失败不应让整篇帖子发布失败 —— 这是刻意的取舍，写在注释里
    expect(read('src/app/api/topics/route.ts')).toContain('标签写入失败');
  });

  it('编辑路由同样**真的调用** attachTags（否则「编辑时补标签」不可用）', () => {
    const route = codeOnly(read('src/app/api/topics/[id]/route.ts'));
    expect(route, 'PUT /api/topics/[id] 必须实际调用标签写入').toMatch(
      /attachTags\(\s*topicId\s*,/,
    );
    expect(route, 'PUT 也必须回显 tags').toContain('tags: appliedTags');
  });

  it('只有一个标签写入实现（禁止发帖/编辑各写一份）', () => {
    const dir = path.join(ROOT, 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(dir);

    const writers = files.filter((f) => /insert\(schema\.topicTags\)/.test(readFileSync(f, 'utf8')));
    const rel = writers.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
    expect(rel, `写入 topic_tags 的位置必须唯一，实际：${rel.join(', ')}`).toEqual([
      'src/server/tags.ts',
    ]);
  });

  it('规范化必须小写 + 去重 + 有上限（否则标签分裂 / 链接 404）', () => {
    const lib = read('src/lib/tag-normalize.ts');
    expect(lib, '必须转小写，否则 React / react 分裂').toContain('.toLowerCase()');
    expect(lib, '必须有去重').toContain('seen.has(tag)');
    expect(lib, '必须有单主题上限').toContain('TAG_MAX_PER_TOPIC');
    expect(lib, '必须有长度上限').toContain('TAG_MAX_LENGTH');
    // 纯模块：不得依赖 server-only / db，否则无法被前端与单测共用
    expect(lib).not.toMatch(/^import\s+'server-only';/m);
    expect(lib).not.toMatch(/^import\s+[^\n]*from\s+'@\/db';/m);
  });

  it('标签写入必须是追加语义（不得先删后插）', () => {
    const server = read('src/server/tags.ts');
    expect(server, '写入必须幂等').toContain('onConflictDoNothing');
    expect(server, '编辑时不得删除已有标签').not.toMatch(/delete\(schema\.topicTags\)/);
  });

  it('主题页读取标签必须与写入共用同一实现，且顺序与 locale 无关', () => {
    const page = read('src/app/t/[id]/page.tsx');
    expect(page, '主题页必须用共用读取函数，避免「页面一套、接口一套」').toContain('loadTagNames');
    const server = codeOnly(read('src/server/tags.ts'));
    // localeCompare 依赖 ICU/locale：同一份数据在 Windows 与 CI 容器可能排出不同顺序。
    // 必须剥离注释再断言 —— 否则「刻意不用 localeCompare」这句说明自己会判红。
    expect(server, '不得使用 localeCompare 排序（结果随 locale 漂移）').not.toContain(
      'localeCompare',
    );
    expect(server, '必须用码点比较，与平台无关').toMatch(/sort\(\(a, b\) => \(a < b/);
  });

  it('标签页路由存在且能按名字查（不是死路由）', () => {
    const page = read('src/app/tag/[name]/page.tsx');
    expect(page).toContain('schema.tags');
    expect(page).toContain('schema.topicTags');
    expect(page, '不存在的标签必须 404 而不是空页').toContain('notFound()');
  });

  it('前端必须有标签输入框（否则功能只有 API 可达）', () => {
    const form = read('src/components/NewTopicForm.tsx');
    expect(form, '发帖表单缺少标签输入').toContain('topic_tags');
    expect(form, '提交时必须把 tags 发给服务端').toMatch(/tags:\s*tags\.trim\(\)/);
  });
});
