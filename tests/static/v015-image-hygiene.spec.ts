import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * 生产镜像卫生护栏（v0.0.15 / V15-11）
 * ============================================================================
 *
 * ## 这个文件在防什么
 *
 * 发布前核查「生产镜像是否存在测试密钥」时发现的**真实缺陷**：
 *
 *   `Dockerfile` 的 runner 阶段写的是
 *       COPY --from=builder /app/scripts ./scripts
 *   （整目录），而 `.dockerignore` 里**没有任何 scripts 规则**。
 *   两者叠加 ⇒ 整个 `scripts/`（45 个文件）全部进了生产镜像，其中：
 *
 *     · `scripts/ci/*.sh`、`scripts/release/verify-upgrade-*.sh` 里
 *       **明文写着测试凭据**（`ci-only-session-secret-…`、
 *       `v2ex_test_password_local_only`、`ci-postgres-password-not-real`）。
 *       它们不是生产凭据（安装器会随机生成），但会把「像真密钥的东西」
 *       带进公开发布的镜像，误导审计、触发扫描器告警。
 *     · `fake-smtp-server.ts` / `reset-test-credentials.ts` / `ui-verify.cjs`
 *       是测试与 CI 专用，运行时一个都不执行。
 *     · `scripts/release/*` 是**发布机**上的工具，容器里跑没有意义。
 *
 * ## 为什么是「白名单」而不是「黑名单」
 *
 * 黑名单（列出要排除的目录）的默认值是「新文件会进镜像」；
 * 白名单（列出要保留的文件）的默认值是「新文件不进镜像」。
 * 对生产镜像而言，后者是安全的方向 —— 漏掉必须显式加白名单才会坏。
 *
 * ## 为什么必须双向断言
 *
 * `.dockerignore` 与 `Dockerfile` 在这里是**双向耦合**的：
 *   · Dockerfile COPY 了但 .dockerignore 排除了 ⇒ builder 里根本没这文件 ⇒ **构建失败**；
 *   · .dockerignore 保留了但 Dockerfile 没 COPY ⇒ 文件白白进构建上下文（含凭据）。
 * 只查一边会让另一边悄悄漂移，所以本文件解析两边的清单并断言**集合相等**。
 */

const ROOT = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** 去掉注释行，只留有效规则（`.dockerignore` 与 Dockerfile 都用得上） */
function effectiveLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

const DOCKERFILE = read('Dockerfile');
const DOCKERIGNORE = read('.dockerignore');

/**
 * 从 Dockerfile 的 **runner 阶段**里提取被 COPY 的 scripts 文件。
 *
 * 只看 runner 阶段：builder 阶段的 `COPY . .` 是构建输入，不是最终镜像内容。
 */
function scriptsInImage(): string[] {
  const lines = DOCKERFILE.split('\n');
  const runnerAt = lines.findIndex((l) => /^FROM\s+.*\bAS\s+runner\b/i.test(l.trim()));
  expect(runnerAt, 'Dockerfile 里找不到 `FROM … AS runner` 阶段').toBeGreaterThanOrEqual(0);

  const out: string[] = [];
  for (const raw of lines.slice(runnerAt)) {
    const line = raw.trim();
    if (!line.startsWith('COPY')) continue;
    // 形如：COPY --from=builder --chown=… /app/scripts/xxx.ts ./scripts/xxx.ts
    const m = line.match(/\/app\/scripts\/([\w./-]+)\s+\.\/scripts\/([\w./-]+)/);
    if (m) out.push(`scripts/${m[1]}`);
    // 整目录 COPY（本轮修复掉的反面写法）—— 显式记为通配，交由下方断言判红
    else if (/\/app\/scripts\s+\.\/scripts\s*$/.test(line)) out.push('scripts/*');
  }
  return [...new Set(out)].sort();
}

/**
 * 从 `.dockerignore` 里推导「最终留在构建上下文里的 scripts 文件」。
 *
 * 用 Docker 的真实语义：**后匹配覆盖前匹配**，`!` 表示反向包含。
 * 这里刻意不手写一份「期望清单」去比对 —— 那样改了 `.dockerignore`
 * 却忘了改测试，测试会变成对旧状态的复述。
 */
function scriptsInContext(allFiles: string[]): string[] {
  const rules = effectiveLines(DOCKERIGNORE).filter((r) => r.includes('scripts'));

  const isIgnored = (p: string): boolean => {
    let state = false;
    for (const rule of rules) {
      const negate = rule.startsWith('!');
      const pattern = (negate ? rule.slice(1) : rule).replace(/\/+$/, '');
      // 覆盖三种写法：精确文件、`dir/*`、`dir`
      const hit =
        p === pattern ||
        p.startsWith(pattern + '/') ||
        (pattern.endsWith('/*') && p.startsWith(pattern.slice(0, -1)));
      if (hit) state = !negate;
    }
    return state;
  };

  return allFiles.filter((p) => !isIgnored(p)).sort();
}

/**
 * 真实枚举磁盘上的 scripts 文件。
 *
 * ⚠️ 第一版这里只枚举「.dockerignore 里提到的路径 + Dockerfile COPY 的路径」。
 *    那是个**自我循环**的枚举：`scripts/*` 这条通配不在候选集里，
 *    于是「移除 scripts/* 排除规则」的负向对照**没有任何候选可泄漏** ⇒ 永不判红。
 *    **是负向对照抓出了这个枚举缺陷** —— 否则这条护栏会一直假绿。
 *    现在改为真实遍历目录：判据必须面对「仓库里实际存在什么」，
 *    而不是面对「我以为存在什么」。
 */
function allScriptFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(path.join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      const abs = path.join(ROOT, rel);
      if (statSync(abs).isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk('scripts');
  return out.sort();
}

describe('生产镜像卫生（v0.0.15）', () => {
  it('Dockerfile 不得整目录 COPY scripts（必须逐文件白名单）', () => {
    const copied = scriptsInImage();
    expect(
      copied,
      'Dockerfile 里出现 `COPY /app/scripts ./scripts` 整目录拷贝。\n' +
        '这会把 scripts/ci 与 scripts/release 一并搬进生产镜像 —— 它们含测试凭据字面量。\n' +
        '请改为逐文件 COPY，并同步 .dockerignore 白名单。',
    ).not.toContain('scripts/*');
  });

  it('.dockerignore 与 Dockerfile 的 scripts 白名单必须**集合相等**', () => {
    const inImage = scriptsInImage();
    const candidates = allScriptFiles();
    const inContext = scriptsInContext(candidates);

    // A ⊆ B：Dockerfile 要 COPY 的，必须留在构建上下文里（否则构建直接失败）
    const missingInContext = inImage.filter((p) => !inContext.includes(p));
    expect(
      missingInContext,
      `以下文件在 Dockerfile 里被 COPY，但被 .dockerignore 排除了 —— 构建会失败：\n` +
        missingInContext.join('\n'),
    ).toEqual([]);

    // B ⊆ A：留在上下文里的，必须都被 COPY（否则白带进构建环境，可能含敏感内容）
    const notCopied = inContext.filter((p) => !inImage.includes(p));
    expect(
      notCopied,
      `以下文件保留在构建上下文里，但 Dockerfile 没有 COPY —— 白带入构建环境：\n` +
        notCopied.join('\n'),
    ).toEqual([]);
  });

  it('容器运行必需的 5 个脚本必须都在镜像里', () => {
    // 依据（不是猜的）：
    //   docker-entrypoint.sh ← ENTRYPOINT
    //   seed.ts / wait-for-db.mjs ← entrypoint 的阶段 1 / 阶段 2
    //   admin-cli.ts ← deploy/INSTALL.md 指导用户在容器内重置口令
    //   db-admin.mjs ← Dockerfile 注释声明的运维脚本
    const required = [
      'scripts/docker-entrypoint.sh',
      'scripts/seed.ts',
      'scripts/wait-for-db.mjs',
      'scripts/admin-cli.ts',
      'scripts/db-admin.mjs',
    ];
    const inImage = scriptsInImage();
    for (const f of required) {
      expect(inImage, `镜像缺运行必需脚本：${f}`).toContain(f);
    }
  });

  it('构建上下文里不得残留含测试凭据字面量的 scripts 文件', () => {
    const candidates = allScriptFiles();
    const inContext = scriptsInContext(candidates);

    // 只对**真实存在**的文件做内容扫描（白名单条目可能指向尚不存在的文件）
    const credentialPattern =
      /ci-only-session-secret|v2ex_test_password_local_only|ci-postgres-password-not-real|ci-redis-password-not-real/;

    const leaked: string[] = [];
    for (const rel of inContext) {
      const abs = path.join(ROOT, rel);
      if (!existsSync(abs)) continue;
      if (credentialPattern.test(read(rel))) leaked.push(rel);
    }

    expect(
      leaked,
      `以下 scripts 文件含测试凭据字面量，却仍留在生产镜像的构建上下文里：\n` +
        leaked.join('\n') +
        '\n（应通过 .dockerignore 排除；它们只用于 CI / 发布机）',
    ).toEqual([]);
  });

  it('负向对照：把 scripts/* 从 .dockerignore 移除后，凭据检查必须判红', () => {
    // 这是**判据有效性**的证明：如果上面那条「不得残留凭据」无论怎么改都不红，
    // 它就是个恒真的假护栏。这里模拟「有人把排除规则删了」。
    const stripped = DOCKERIGNORE.split('\n')
      .filter((l) => !/^\s*scripts\/\*/.test(l))
      .join('\n');

    const rules = effectiveLines(stripped).filter((r) => r.includes('scripts'));
    const isIgnored = (p: string): boolean => {
      let state = false;
      for (const rule of rules) {
        const negate = rule.startsWith('!');
        const pattern = (negate ? rule.slice(1) : rule).replace(/\/+$/, '');
        const hit =
          p === pattern ||
          p.startsWith(pattern + '/') ||
          (pattern.endsWith('/*') && p.startsWith(pattern.slice(0, -1)));
        if (hit) state = !negate;
      }
      return state;
    };

    // 去掉 `scripts/*` 后，只有 `!scripts/xxx` 这些反向规则，
    // 而反向规则**不能**把未被排除的文件变成被排除 ⇒ 全部文件都会留下。
    const candidates = allScriptFiles().filter((p) => existsSync(path.join(ROOT, p)));
    const kept = candidates.filter((p) => !isIgnored(p));
    const leaked = kept.filter((p) => {
      const abs = path.join(ROOT, p);
      if (!existsSync(abs)) return false;
      return /ci-only-session-secret|v2ex_test_password_local_only/.test(read(p));
    });

    expect(
      leaked.length,
      '负向对照失败：移除 scripts/* 排除规则后，凭据检查**没有**判红 —— ' +
        '说明这条护栏是恒真的假护栏',
    ).toBeGreaterThan(0);
  });
});
