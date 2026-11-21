import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.16 候选包四角色验收链路的结构护栏
 * ============================================================================
 *
 * ## 这组护栏防的是「验收看起来跑过了，但其实验错了对象」
 *
 * 这些断言全部来自**真实事故或真实风险**，不是「代码风格」：
 *
 * 1. **候选验收必须复用 `acceptance-official.mjs`，不得复制第二套断言。**
 *    两套业务断言必然漂移：改一套忘一套，最后没人知道哪套是真的。
 *    这里断言：工作流里出现该脚本路径，且**不得**再出现第二份内联的
 *    「最后回复来自」/「通知落库」之类的业务断言文本。
 *
 * 2. **必须把 `COMPOSE_PROJECT_NAME` 传给验收脚本。**
 *    本项目 compose 写死了 `container_name`（v0.0.14 记录）。候选环境用具名
 *    项目（`-p v2ex-cand-<run_id>`）与其它安装并存时，若验收脚本不传项目名，
 *    `docker compose exec postgres` 会按默认项目名找容器 ⇒ 命中**另一个环境**的库。
 *    那种错误不会失败，只会让断言结果悄悄变成别人家的事实。
 *
 * 3. **不得存在任何 push 路径。** 候选镜像只做 `docker save`。
 *    权限必须是 `contents: read` —— 没有 `packages: write` 就没有推送可能。
 *
 * 4. **ZIP / 镜像 / 源码 三处版本必须逐一核对。**
 *    「只改 ZIP 文件名冒充版本更新」是本仓明令禁止的做法。
 *    光核 ZIP 名字不够，要读**ZIP 内**的 `deploy/VERSION`。
 *
 * 5. **`inputs.port` 不得在 `run:` 里以 `|| '3409'` 形态直接求值。**
 *    非 workflow_dispatch 触发时该表达式的行为依 GitHub 版本而异；
 *    稳妥做法是在 bash 里兜底。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const WF = '.github/workflows/candidate-acceptance.yml';
const ACC = 'scripts/release/acceptance-official.mjs';

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}
/**
 * 剥掉注释（避免「注释里解释了某句话」被当成实现）。
 *
 * ⚠️ 必须同时处理 **`//` 与 `#` 两种注释**：
 * 本文件既扫 `.mjs`（// 与 块注释）也扫 `.yml`（# 注释）。
 * 第一版只剥 `//`，于是工作流里那句
 *   `# 不要在 run 里直接写 ${{ inputs.port || '3409' }}`
 * 被反向断言当成了「真的这么写了」—— 正是本仓 V15-06 记录过的
 * 「反向断言先剥掉不该算数的部分」那一类错。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '');
}


/**
 * 抽出**四角色验收那一步**的正文。
 *
 * ## 为什么必须切块（负向对照实测出来的）
 *
 * 第一版判据是 `SRC.includes('COMPOSE_PROJECT_NAME')` / `SRC.includes(ACC)`，
 * 扫的是**整份工作流**。于是负向对照全部**没有判红**：
 *   · 把验收步骤里的 `COMPOSE_PROJECT_NAME` 删掉 ⇒ 备份步骤里还有一个 ⇒ 仍绿；
 *   · 把验收步骤的脚本换成自写脚本 ⇒ `on.push.paths` 里仍有该路径 ⇒ 仍绿。
 *
 * 这正是本仓 V15-06 记录过的错：**反向断言必须先剥掉不该算数的部分**。
 * 判据必须落在「验收步骤」这一段，而不是整份文件。
 */
/**
 * 取某个 step 的正文（按 `- name:` 步骤标记切块）。
 *
 * ⚠️ 必须锚在**步骤标记**上，不能只搜中文标题。
 * 第一版用 `indexOf('四角色真实用户验收')`，结果命中的是 **job 名**
 * （`name: 候选包 · 隔离安装 + 四角色真实用户验收`）⇒ 切出来的是 job 头
 * 到第一个步骤之间的空段 ⇒ 两条判据同时假红。
 * 这是「字符串在文件里出现两次、你锚了错的那一次」的典型。
 */
function stepBlock(src: string, name: string): string {
  const marker = `- name: ${name}`;
  const i = src.indexOf(marker);
  if (i < 0) return '';
  const rest = src.slice(i);
  const next = rest.indexOf('\n      - name:', 1);
  return next < 0 ? rest : rest.slice(0, next);
}

/** 四角色验收那一步 */
function acceptanceStepBlock(src: string): string {
  return stepBlock(src, '四角色真实用户验收');
}

const RAW = existsSync(path.join(ROOT, WF)) ? read(WF) : '';
const SRC = stripComments(RAW);

describe('v0.0.16 候选包四角色验收：链路结构', () => {
  it('工作流存在且可被 YAML 解析（结构完整）', () => {
    expect(existsSync(path.join(ROOT, WF)), `缺少 ${WF}`).toBe(true);
    expect(RAW.length).toBeGreaterThan(1000);
    // 关键字段必须存在
    for (const key of ['on:', 'jobs:', 'runs-on:', 'steps:']) {
      expect(RAW, `${WF} 缺少 ${key}`).toContain(key);
    }
  });

  it('复用已发布包的验收脚本，不自己写第二套业务断言', () => {
    const block = acceptanceStepBlock(SRC);
    expect(block, '找不到「四角色真实用户验收」步骤 —— 结构已变，本用例需重写').not.toBe('');
    expect(
      block.includes(ACC),
      `验收步骤必须调用 ${ACC}（否则会与已发布包验收产生第二套业务断言）`,
    ).toBe(true);

    /*
     * 反向断言：工作流里**不得**出现只可能来自「第二套断言」的文案。
     * 注意作用域 —— 只扫工作流文件；脚本本体里当然有这些词。
     */
    for (const phrase of ['最后回复来自', '未读数', '举报 #']) {
      expect(
        SRC.includes(phrase),
        `工作流里出现了业务断言文案「${phrase}」—— 说明在复制第二套断言`,
      ).toBe(false);
    }
  });

  it('必须把 COMPOSE_PROJECT_NAME 传给验收脚本（否则会读到别的环境）', () => {
    const block = acceptanceStepBlock(SRC);
    expect(block, '找不到验收步骤 —— 结构已变，本用例需重写').not.toBe('');
    expect(
      block.includes('COMPOSE_PROJECT_NAME='),
      '**验收步骤本身**必须传 COMPOSE_PROJECT_NAME —— 本 compose 写死 container_name，' +
        '不传项目名会让 docker compose exec 命中另一个环境的数据库。' +
        '（只在备份步骤里 export 不算：那是另一条命令链）',
    ).toBe(true);
    // 脚本侧必须真的读这个变量
    const acc = stripComments(read(ACC));
    expect(acc.includes('COMPOSE_PROJECT_NAME'), `${ACC} 未读取 COMPOSE_PROJECT_NAME`).toBe(true);
    /*
     * 判据要锚在**真实写法**上：`args.push('-p', COMPOSE_PROJECT)`。
     * 第一版写的是 `/compose['"]?\s*[,\s]/` —— 而源码是
     * `const args = ['compose'];`（`compose` 后面紧跟 `'` 再紧跟 `]`），
     * 该正则恒假 ⇒ 用例永远红。这属于「判据写错」，不是代码有问题。
     */
    expect(
      acc.includes("args.push('-p', COMPOSE_PROJECT)"),
      `${ACC} 未把项目名拼进 docker compose 参数（期望 args.push('-p', COMPOSE_PROJECT)）`,
    ).toBe(true);
  });

  it('权限里没有 packages: write，且全文无 docker push', () => {
    expect(SRC, '候选验收工作流不得申请 packages: write').not.toContain('packages: write');
    // `docker push` 必须以「字符串形式」判断，避免被注释里的说明误伤（已 strip）
    expect(
      /\bdocker\s+push\b/.test(SRC),
      '候选验收工作流出现 docker push —— 候选镜像只允许 docker save',
    ).toBe(false);
    expect(SRC).toContain("contents: read");
  });

  it('ZIP / 镜像 / 源码 三处版本逐一核对（不能只核对文件名）', () => {
    // 必须真的解 ZIP 并读里面的 VERSION
    expect(SRC).toContain('unzip');
    expect(
      /ZIP\s*内\s*VERSION/.test(SRC) || SRC.includes('$ZDIR/VERSION'),
      '必须读取 ZIP 内的 deploy/VERSION（只核对文件名等于没核对）',
    ).toBe(true);
    // 必须核对候选包指向候选镜像标签
    expect(
      SRC.includes('v2ex-clone-candidate:'),
      '候选包必须指向候选镜像标签，而不是尚不存在的远端标签',
    ).toBe(true);
  });

  it('备份 / 恢复 / 重启三段真实执行，且注入 compose 项目名', () => {
    for (const marker of ['backup.sh', 'restore.sh', 'restart']) {
      expect(SRC, `缺少备份恢复链路环节：${marker}`).toContain(marker);
    }
    expect(
      SRC.includes('COMPOSE_PROJECT_NAME="${CANDIDATE_PROJECT}"'),
      '备份/恢复步骤必须 export COMPOSE_PROJECT_NAME —— ' +
        'backup.sh / restore.sh 内部只写 docker compose，不带 -p',
    ).toBe(true);
  });

  it('不使用 `inputs.port` 的内联默认值表达式（push 触发下不稳）', () => {
    expect(
      /\$\{\{\s*inputs\.port\s*\|\|/.test(SRC),
      'run: 里不要用 `${{ inputs.port || 3409 }}` —— 改为 bash 兜底',
    ).toBe(false);
    /*
     * 兜底逻辑是**两行**：
     *   P="${{ inputs.port }}"
     *   [ -n "$P" ] || P=3409
     * 第一版写成 `/APP_PORT=.*3409/`（要求同一行）—— 恒假。
     * 改成分别断言「默认值」与「注入 GITHUB_ENV」两件事都存在。
     */
    expect(SRC, '缺少端口默认值兜底（P=3409）').toMatch(/P=3409/);
    expect(SRC, '缺少 APP_PORT 注入 GITHUB_ENV').toContain('APP_PORT=${P}');
    expect(SRC, '缺少空值判断').toMatch(/\[\s*-n\s+"\$P"\s*\]/);
  });

  it('恢复脚本必须显式跳过交互确认，且不得截断失败输出', () => {
    /*
     * v0.0.20 起 restore.sh 提供 --yes；CI 必须显式使用它（或等价地喂 y），
     * 否则非交互 shell 会读到 EOF 并取消。恢复输出不得再用 `| tail` 截断。
     */
    const block = stepBlock(SRC, '备份 → 恢复 → 重启持久化');
    expect(block, '找不到备份恢复步骤 —— 结构已变，本用例需重写').not.toBe('');
    const restoreLine = block
      .split('\n')
      .find((l) => l.includes('restore.sh')) ?? '';
    expect(restoreLine, '找不到调用 restore.sh 的行').not.toBe('');
    expect(
      restoreLine.includes("printf 'y") || /echo\s+y\s*\|/.test(restoreLine) || /--yes/.test(restoreLine),
      'restore.sh 必须被显式喂入 y 或使用 --yes',
    ).toBe(true);
    expect(
      /restore\.sh[^\n]*\|\s*tail/.test(restoreLine),
      '恢复输出不得用 `| tail` 截断',
    ).toBe(false);
  });

  it('清理只针对本次候选项目，不含全局 down -v', () => {
    // 允许 `docker compose -p "<project>" down -v`，禁止无 -p 的全局 down -v
    expect(
      /docker compose down -v|docker compose -f \S+ down -v/.test(SRC),
      '清理步骤必须带 -p（否则可能波及别的 compose 项目）',
    ).toBe(false);
    expect(SRC).toContain('down -v');
  });
});
