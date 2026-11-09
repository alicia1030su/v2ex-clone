import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

/**
 * 取出某个**已导出函数声明**的函数体源码。
 *
 * 为什么要精确到函数体：v0.0.14 的 `src/server/tags.ts` 里同时存在
 * 「追加」（`attachTags`，**不得** delete）与「移除」（`detachTags`，**必须** delete）
 * 两种语义。对整个文件做 `not.toMatch(/delete/)` 会把正确实现判红；
 * 而对整个文件做 `toMatch` 又挡不住"有人把 delete 挪进 attachTags"。
 * 只有按函数切分才能同时表达这两条互斥的约束。
 *
 * ## 为什么用 TypeScript 解析器而不是手写括号配平
 *
 * 第一版是朴素配平：从 `function <name>(` 往后找第一个 `{` 开始配平。
 * 这**在真实代码上假红**：`listTopicsByTag` 的返回类型是
 * `Promise<{ items: …; total: number }>` —— 返回类型里的对象字面量
 * 先被命中，于是"函数体"退化成一段类型声明（`toContain('schema.topicTags')` 必失败）。
 * 第二版改成"先跳过参数表再找 `{`"，仍然只是**更聪明的猜测**：
 * 泛型约束、默认值里的对象字面量、解构参数都能再把它骗一次。
 *
 * 用 AST 取 `node.body.getFullStart()/getEnd()` 是**精确**的，
 * 且 TypeScript 已是本仓 devDependency（`tests/static/v008-syntax-guards.spec.ts`
 * 已在用同一个解析器）—— 不必自己造一个脆弱的提取器。
 */
function functionBody(src: string, name: string): string {
  const file = ts.createSourceFile(
    'guard-target.ts',
    src,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  let found = '';
  const visit = (node: ts.Node): void => {
    if (found !== '') return;
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name?.getText(file) === name &&
      node.body
    ) {
      found = node.body.getText(file);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

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

    // v0.0.14：移除语义必须真的接上（否则前端「×」按钮是假控件 ——
    // 本仓 V4-04「编辑按钮点了没反应」就是同类缺陷）
    expect(route, 'PUT 必须实际调用 detachTags').toMatch(/detachTags\(\s*topicId\s*,/);
    expect(route, '只提交 removeTags 也必须是合法请求').toContain('body.removeTags === undefined');
    // 回显必须是**库里最终**的状态，而不是本次输入（否则额度截断时会误导前端）
    expect(route, '必须从库里回读最终标签').toMatch(/loadTagNames\(\s*topicId\s*\)/);

    // 顺序：先移除、再追加（「删一个加一个」在满额时才能成功）
    const detachAt = route.indexOf('detachTags(');
    const attachAt = route.indexOf('attachTags(');
    expect(detachAt, 'detachTags 必须出现在代码里').toBeGreaterThan(-1);
    expect(attachAt, 'attachTags 必须出现在代码里').toBeGreaterThan(-1);
    expect(detachAt, '必须先 detachTags 再 attachTags（否则满额时新标签会被丢弃').toBeLessThan(
      attachAt,
    );

    // 鉴权必须先于任何标签写入：`editTopic()` 是唯一的授权 + 编辑时限校验点
    const editAt = route.indexOf('editTopic(');
    expect(editAt, '必须调用 editTopic（鉴权唯一权威）').toBeGreaterThan(-1);
    expect(editAt, '标签写入不得早于 editTopic：否则未授权请求也能改标签').toBeLessThan(
      Math.min(detachAt, attachAt),
    );
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

  it('标签写入必须是追加语义（attachTags 不得先删后插）', () => {
    const server = read('src/server/tags.ts');
    expect(server, '写入必须幂等').toContain('onConflictDoNothing');

    // ⚠️ v0.0.14（P0-2 配套）：断言范围从「整个文件」收紧到「函数体」。
    //
    //    原断言是 `expect(server).not.toMatch(/delete\(schema\.topicTags\)/)`，
    //    它防的是"编辑时把历史标签删掉"。新增的 `detachTags()` 是**显式移除**
    //    语义（用户点 × 删标签），它当然要 delete —— 于是原断言会把正确实现判红。
    //
    //    **不删断言、不放宽**：改为对 `attachTags` 的函数体断言（比原断言更精确），
    //    并对 `detachTags` 追加两条新断言（只删关联行、绝不删标签本体）。
    const code = codeOnly(server);
    const attachBody = functionBody(code, 'attachTags');
    const detachBody = functionBody(code, 'detachTags');
    expect(attachBody, 'attachTags 函数体必须存在（否则下面的断言是空转）').toContain('sortByCodePoint');
    expect(attachBody, 'attachTags 不得删除已有标签').not.toMatch(/delete\(schema\.topicTags\)/);
    expect(detachBody, 'detachTags 必须真的删除关联行').toMatch(/delete\(schema\.topicTags\)/);
    expect(detachBody, 'detachTags 不得删除标签本体（会破坏其它主题）').not.toMatch(
      /delete\(schema\.tags\)/,
    );
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

  it('前端必须有标签**移除**入口（否则功能只有 API 可达）', () => {
    const form = codeOnly(read('src/components/TopicEditForm.tsx'));

    // 「能加不能减」曾是一个真实的体验缺陷：用户可以打错标签，但界面上
    // 没有任何办法去掉它。只做 API 层的 removeTags 等于功能不可达
    // （本仓 V4-04「编辑按钮点了没反应」就是同类：有实现、界面上够不着）。
    expect(form, '表单必须收集当前标签').toMatch(/initialTags/);
    expect(form, '提交体必须包含 removeTags（移除语义）').toMatch(/removeTags/);
    // 追加标签输入框的 name：**不能**用 `tags` 之类可能与 DOM 属性冲突/歧义的名字
    // （V4-20：input 的 name 不得与 HTMLFormElement 属性同名）。
    expect(form, '追加标签输入框必须存在且名为 topic_tags_add').toContain('topic_tags_add');
    // 每个 chip 都要有明确的可访问名称，否则键盘/读屏用户无法移除。
    // 实现是三元式（`aria-label={removed ? '撤销移除标签 x' : '移除标签 x'}`），
    // 所以断言「存在一个 aria-label 且其取值里含『移除标签』」而不是写死字面量。
    const ariaLabels = form.match(/aria-label=(?:"[^"]*"|\{[^}]*\})/g) ?? [];
    expect(
      ariaLabels.some((l) => l.includes('移除标签')),
      `移除按钮必须有含「移除标签」的 aria-label，实际：${ariaLabels.join(' | ')}`,
    ).toBe(true);

    // 透传链路：TopicActions 必须把 initialTags 交给表单，
    // 否则页面即便查了标签也传不进编辑框（典型的"接线漏一环"）。
    const actions = codeOnly(read('src/components/TopicActions.tsx'));
    expect(actions, 'TopicActions 必须声明 initialTags').toMatch(/initialTags\?:/);
    expect(actions, 'TopicActions 必须把 initialTags 透传给表单').toMatch(
      /initialTags=\{initialTags\}/,
    );
  });

  it('主题页必须把当前标签传给编辑表单（否则「移除」入口在界面上够不着）', () => {
    // 这是一条**接线**断言，不是"某字符串存在"断言：
    //   `TopicActions` 声明了 `initialTags` 但页面不传 ⇒ 组件拿到默认 `[]`
    //   ⇒ 编辑框里没有标签 chips ⇒ 用户无法移除自己打错的标签。
    //   而 API 层、服务层、真库测试**全都是绿的** —— 这类"功能全对但界面不可达"
    //   的缺口（见 V4-04 假按钮）只有这种跨文件的接线断言能挡住。
    const page = codeOnly(read('src/app/t/[id]/page.tsx'));
    expect(page, '主题页必须已用 loadTagNames 取到当前标签').toContain('loadTagNames');
    expect(
      page,
      '必须把标签名传给 TopicActions：initialTags={tags.map((t) => t.name)}',
    ).toMatch(/initialTags=\{tags\.map\(/);
  });

  it('标签页路由存在且能按名字查（不是死路由）', () => {
    const page = codeOnly(read('src/app/tag/[name]/page.tsx'));
    expect(page).toContain('schema.tags');
    expect(page, '不存在的标签必须 404 而不是空页').toContain('notFound()');

    // ⚠️ v0.0.14 P0-1 合并后的口径调整（**收紧**，不是放宽）：
    //
    //    原断言要求页面里出现 `schema.topicTags` —— 那时列表查询是**页面内联**的 SQL。
    //    合并后列表收敛到 `src/server/queries.ts` 的 `listTopicsByTag()`（这样
    //    隐藏节点的可见性条件才有唯一落点，页面内联 SQL 无法被真库测试覆盖）。
    //    因此断言改为：页面**必须**调用那个共用查询，且那个查询**真的**按
    //    `topic_tags ⋈ tags` 关联查（否则「标签页能查到主题」这件事没有保证）。
    expect(page, '标签页必须走共用查询 listTopicsByTag()').toMatch(/listTopicsByTag\(/);
    expect(
      page,
      '页面不得再内联手写 topic_tags 关联（否则可见性条件会漏一条路径）',
    ).not.toContain('schema.topicTags');

    const queries = codeOnly(read('src/server/queries.ts'));
    expect(queries, 'listTopicsByTag 必须存在').toMatch(
      /export\s+async\s+function\s+listTopicsByTag\(/,
    );
    // 取函数体断言，避免被文件里其它函数的 join 蒙混过关
    const body = functionBody(queries, 'listTopicsByTag');
    expect(body, '必须按关联行查（不是只看 tags 表）').toContain('schema.topicTags');
    expect(body, '必须按标签名查').toContain('schema.tags.name');
    // 分页总数必须来自独立 count：`rows.length` 会被 limit 截断 ⇒ totalPages 恒为 1
    expect(body, '必须独立 count（否则第 2 页永远不可达）').toContain('count()');
  });

  it('前端必须有标签输入框（否则功能只有 API 可达）', () => {
    const form = read('src/components/NewTopicForm.tsx');
    expect(form, '发帖表单缺少标签输入').toContain('topic_tags');
    expect(form, '提交时必须把 tags 发给服务端').toMatch(/tags:\s*tags\.trim\(\)/);
  });
});
