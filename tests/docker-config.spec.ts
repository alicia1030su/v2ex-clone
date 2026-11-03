import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './helpers/local-bin';

/**
 * 部署配置回归测试（P0-2 / P0-3 / P0-4 / P0-5）
 *
 * 这些测试针对**配置文件本身**做静态断言，捕捉曾经出现过的真实问题：
 *
 *  P0-2  Dockerfile 在每次容器启动时执行 seed
 *        → 重新部署会重置管理员口令、污染用户数据
 *  P0-3  docker-compose.yml 默认把 PostgreSQL / Redis 暴露到宿主机
 *  P0-4  public/ 未被 Git 跟踪 → 干净克隆后 Dockerfile 的 COPY 失败
 *  P0-5  scripts/verify.sh 写死本机 Windows 路径 → 在 CI / 其他机器上必然失败
 *
 * 说明：Docker 镜像的**真实构建与启动**由 GitHub Actions 的 `docker` job
 * 验证（.github/workflows/ci.yml）—— 本机没有可用的容器引擎，
 * 静态断言无法替代真实构建。
 */

function read(relPath: string): string {
  const p = path.join(repoRoot, relPath);
  if (!existsSync(p)) {
    throw new Error(`文件不存在: ${relPath}`);
  }
  return readFileSync(p, 'utf8');
}

/**
 * 去掉注释，只保留**实际生效**的代码。
 *
 * 为什么需要：这些文件里大量注释在**描述被修复的旧问题**，
 * 例如「旧版本硬编码了 /c/Users/TYMO001/... 的 Windows 路径」。
 * 直接对全文做断言会把说明文字误判成残留的硬编码。
 *
 * 支持两种注释风格：shell 的 `#` 与 JS 的 `//`。
 */
function stripComments(content: string): string {
  // 先整体去掉块注释（/* ... */ 与 /** ... */），
  // 否则 JSDoc 里的示例路径会被当成实际代码。
  const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m
      .split(/\r?\n/)
      .map(() => '')
      .join('\n'),
  );

  return withoutBlocks
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      // 整行注释
      if (trimmed.startsWith('#')) return '';
      if (trimmed.startsWith('//')) return '';

      // 行尾注释：简单处理 —— 不考虑引号内的符号
      const hashIdx = line.indexOf('#');
      const slashIdx = line.indexOf('//');
      const candidates = [hashIdx, slashIdx].filter((i) => i !== -1);
      if (candidates.length === 0) return line;

      const idx = Math.min(...candidates);
      const before = line.slice(0, idx);
      const quoteCount = (before.match(/["'`]/g) ?? []).length;
      return quoteCount % 2 === 0 ? before : line;
    })
    .join('\n');
}

/** 提取 YAML 中某个 service 段落的文本（按 2 空格缩进切分） */
function serviceBlock(yaml: string, service: string): string {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    // 下一个同级别 key（2 空格缩进）出现时结束
    if (/^ {2}\S/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

describe('Dockerfile 启动阶段分离（P0-2）', () => {
  const dockerfile = read('Dockerfile');

  it('使用 entrypoint 而不是把迁移与 seed 串在 CMD 里', () => {
    expect(dockerfile).toContain('ENTRYPOINT');
    expect(dockerfile).toContain('docker-entrypoint.sh');
  });

  it('CMD 不再直接串联 migrate 与 seed', () => {
    // 旧写法：CMD ["sh", "-c", "npx drizzle-kit migrate && npx tsx scripts/seed.ts && ..."]
    const cmdLine = dockerfile
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith('CMD'));
    expect(cmdLine).toBeDefined();
    expect(cmdLine).not.toContain('seed.ts');
    expect(cmdLine).not.toContain('migrate');
  });

  it('entrypoint 脚本存在且区分三个阶段', () => {
    const entrypoint = stripComments(read('scripts/docker-entrypoint.sh'));
    expect(entrypoint).toContain('run_migrate');
    expect(entrypoint).toContain('run_init');
    expect(entrypoint).toContain('run_start');
    // 阶段 2 与阶段 3 必须分开，不能再是 migrate && seed && start
    expect(entrypoint).not.toMatch(/migrate\s*&&\s*seed/);
  });

  it('entrypoint 的 init 阶段调用 seed（由 seed 内部的标记守卫）', () => {
    const entrypoint = read('scripts/docker-entrypoint.sh');
    expect(entrypoint).toContain('scripts/seed.ts');
  });

  it('seed 脚本带首次初始化标记逻辑', () => {
    const seed = read('scripts/seed.ts');
    expect(seed).toContain('INIT_MARKER_KEY');
    expect(seed).toContain('kvStore');
    // 已初始化时必须提前返回
    expect(seed).toContain('跳过 seed');
  });

  it('seed 不会覆盖已有账号的口令与角色', () => {
    const seed = read('scripts/seed.ts');
    // 更新已有用户的 passwordHash / role 是被禁止的
    expect(seed).not.toMatch(/\.update\(schema\.users\)[\s\S]{0,200}passwordHash/);
    expect(seed).not.toMatch(/\.update\(schema\.users\)[\s\S]{0,200}role:/);
  });

  it('seed 的口令是惰性解析的（已存在账号不需要 SEED_ADMIN_PASSWORD）', () => {
    const seed = read('scripts/seed.ts');
    expect(seed).toContain('resolvePassword');
  });

  it('seed 写入了初始化标记（保证重新部署不重复初始化）', () => {
    const seed = read('scripts/seed.ts');
    expect(seed).toContain('INIT_MARKER_KEY');
    // 标记必须在写入数据**之后**设置（失败时不打标记，下次会重试）
    const markerWrite = seed.indexOf('.insert(schema.kvStore)');
    const topicWrite = seed.indexOf('.insert(schema.topics)');
    expect(markerWrite).toBeGreaterThan(-1);
    expect(topicWrite).toBeGreaterThan(-1);
    expect(markerWrite).toBeGreaterThan(topicWrite);
  });

  it('seed 同步楼层计数表（避免楼层号漂移导致 500）', () => {
    const seed = read('scripts/seed.ts');
    expect(seed).toContain('floorCounters');
  });
});

describe('docker-compose 默认不暴露数据库端口（P0-3）', () => {
  const compose = read('docker-compose.yml');

  it('postgres 服务没有 ports 映射', () => {
    const block = serviceBlock(compose, 'postgres');
    expect(block).not.toBe('');
    expect(block).not.toMatch(/^\s*ports:/m);
  });

  it('redis 服务没有 ports 映射', () => {
    const block = serviceBlock(compose, 'redis');
    expect(block).not.toBe('');
    expect(block).not.toMatch(/^\s*ports:/m);
  });

  it('app 服务仍然暴露应用端口', () => {
    const block = serviceBlock(compose, 'app');
    expect(block).toMatch(/^\s*ports:/m);
  });

  it('定义了内部网络 v2ex-net', () => {
    expect(compose).toContain('v2ex-net');
    expect(compose).toMatch(/networks:\s*\n\s+v2ex-net:/);
  });

  it('postgres 与 redis 都接入内部网络', () => {
    expect(serviceBlock(compose, 'postgres')).toContain('v2ex-net');
    expect(serviceBlock(compose, 'redis')).toContain('v2ex-net');
  });

  it('提供显式开启端口的 debug override 文件', () => {
    const debug = read('docker-compose.debug.yml');
    expect(debug).toContain('127.0.0.1');
    // 绝不能绑到 0.0.0.0
    expect(debug).not.toMatch(/['"]0\.0\.0\.0:/);
  });
});

describe('public/ 目录存在且被 Git 跟踪（P0-4）', () => {
  it('public/ 目录在仓库中存在', () => {
    expect(existsSync(path.join(repoRoot, 'public'))).toBe(true);
  });

  it('public/ 下有被跟踪的文件（否则干净克隆会丢失该目录）', () => {
    // Git 不跟踪空目录 —— 必须有至少一个文件让目录随克隆一起出现
    const files = ['public/README.md', 'public/favicon.svg', 'public/static/.gitkeep'];
    for (const f of files) {
      expect(existsSync(path.join(repoRoot, f)), `${f} 应存在`).toBe(true);
    }
  });

  it('.dockerignore 没有把 public/ 排除掉', () => {
    const dockerignore = read('.dockerignore');
    const lines = dockerignore.split(/\r?\n/).map((l) => l.trim());
    expect(lines).not.toContain('public');
    expect(lines).not.toContain('public/');
  });

  it('Dockerfile 先建目录再复制，兼容空目录', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/mkdir -p \/app\/public/);
  });

  it('Dockerfile 拷入 seed/admin-cli 运行所需的 src/db 与 password 模块', () => {
    const dockerfile = read('Dockerfile');
    // 缺 src/db 时容器启动会报：
    //   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/db/index'
    expect(dockerfile).toMatch(/COPY .*\/app\/src\/db \.\/src\/db/);
    // 只拷真正用到的 lib 模块 —— 整目录拷贝会带进 server-only 模块
    expect(dockerfile).toMatch(/COPY .*\/app\/src\/lib\/password\.ts/);
    // 不得整目录拷贝 src/lib
    expect(dockerfile).not.toMatch(/COPY .*\/app\/src\/lib \.\/src\/lib/);
  });

  it('Dockerfile 拷贝了运行期脚本依赖的全部文件', () => {
    const dockerfile = read('Dockerfile');
    for (const needed of [
      '/app/drizzle ',
      '/app/scripts ',
      '/app/drizzle.config.ts',
      '/app/package.json',
    ]) {
      expect(dockerfile, `应拷贝 ${needed.trim()}`).toContain(needed);
    }
  });
});

describe('verify.sh 跨平台（P0-5）', () => {
  const verifyRaw = read('scripts/verify.sh');
  const verify = stripComments(verifyRaw);

  it('不含写死的本机 Windows 路径', () => {
    // 旧版写死了 /c/Users/TYMO001/... 的绝对路径
    expect(verify).not.toMatch(/\/c\/Users\/[A-Za-z0-9_-]+\//);
    expect(verify).not.toContain('C:\\Users\\');
    expect(verify).not.toContain('node-v22');
  });

  it('不依赖 psql 命令行工具', () => {
    // 数据库操作改由 scripts/db-admin.mjs 承担
    expect(verify).not.toContain('psql');
    expect(verify).toContain('scripts/db-admin.mjs');
  });

  it('区分 Windows 与 POSIX 的进程管理', () => {
    expect(verify).toContain('IS_WINDOWS');
    expect(verify).toContain('taskkill');
    expect(verify).toContain('lsof');
  });

  it('有数据库隔离闸门，拒绝在非验证库上执行破坏性操作', () => {
    expect(verify).toContain('目标库校验通过');
    expect(verify).toMatch(/fail "拒绝在非验证库/);
  });

  it('启动服务前会清空端口占用', () => {
    expect(verify).toContain('stop_stale_servers');
  });

  it('辅助脚本本身不含硬编码路径', () => {
    for (const f of ['scripts/db-admin.mjs', 'scripts/env-dump.mjs', 'scripts/wait-for-db.mjs']) {
      const content = stripComments(read(f));
      expect(content, `${f} 不应含本机绝对路径`).not.toMatch(/\/c\/Users\/[A-Za-z0-9_-]+\//);
      expect(content, `${f} 不应含本机绝对路径`).not.toContain('C:\\Users\\');
    }
  });
});

describe('CI 配置存在且使用隔离服务（P0-5）', () => {
  const ci = read('.github/workflows/ci.yml');

  it('定义了 PostgreSQL 与 Redis 服务容器', () => {
    expect(ci).toContain('postgres:');
    expect(ci).toContain('postgres:17-alpine');
    expect(ci).toContain('redis:');
    expect(ci).toContain('redis:7-alpine');
  });

  it('包含 Docker 构建与启动验证 job', () => {
    expect(ci).toContain('docker build');
    expect(ci).toContain('docker compose');
    // 必须真的启动容器并做健康检查
    expect(ci).toContain('up -d');
    expect(ci).toMatch(/curl .*localhost:3000/);
  });

  it('验证重新部署不会重置管理员口令', () => {
    expect(ci).toContain('restart app');
    expect(ci).toContain('管理员口令在重新部署后被重置');
  });

  it('验证默认配置不暴露数据库端口', () => {
    expect(ci).toContain('published:');
    expect(ci).toContain('不应向宿主机暴露端口');
  });

  it('使用临时生成的凭据，不含真实密钥', () => {
    expect(ci).not.toMatch(/gho_[A-Za-z0-9]{30,}/);
    expect(ci).not.toMatch(/ghp_[A-Za-z0-9]{30,}/);
    expect(ci).not.toMatch(/sk-[A-Za-z0-9]{40,}/);
    expect(ci).toContain('ci-postgres-password-not-real');
  });
});

describe('开源发布条件（P0-7）', () => {
  it('存在 LICENSE 且包含商标声明', () => {
    const license = read('LICENSE');
    expect(license).toContain('MIT License');
    expect(license).toContain('TRADEMARK NOTICE');
    expect(license).toContain('商标');
  });

  it('package.json 声明了 license 与仓库地址', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.license).toBe('MIT');
    expect(pkg.repository.url).toContain('github.com/alicia1030su/v2ex-clone');
    expect(pkg.description).not.toBe('');
  });

  it('README 包含功能完成度与开源发布章节', () => {
    const readme = read('README.md');
    // 「完成度声明」在 v0.0.1 重写后表述为「功能完成度」，
    // 断言接受任一表述，但**必须**存在功能完成度的披露。
    expect(
      readme.includes('完成度声明') || readme.includes('功能完成度'),
      'README 必须披露功能完成度',
    ).toBe(true);
    expect(readme).toContain('许可证');
    // 开源发布条件在 v0.0.1 重写后由「许可证」+「当前版本」两节承载，
    // 必须同时存在，且需明确当前版本号与发布形态。
    expect(readme).toContain('## 许可证');
    expect(readme).toContain('v0.0.1');
    expect(readme).toMatch(/Pre-release|开发预览版/);
  });

  it('.env.example 不提供任何可用的默认口令', () => {
    const env = read('.env.example');
    const secretKeys = [
      'POSTGRES_PASSWORD',
      'REDIS_PASSWORD',
      'SESSION_SECRET',
      'SEED_ADMIN_PASSWORD',
    ];
    for (const key of secretKeys) {
      const line = env.split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
      expect(line, `${key} 应存在于 .env.example`).toBeDefined();
      const value = line!.split('=').slice(1).join('=').trim();
      expect(value, `${key} 不应有可用默认值`).toBe('');
    }
  });

  it('历史清理的内部处置文档不入库，但公开文档如实披露现状', () => {
    // 内部处置方案与演练报告含原站素材路径、泄露细节与不可逆操作指引，
    // 属于仓库维护者的内部记录，**不随公开发布版本分发**。
    const tracked = execFileSync('git', ['ls-files'], {
      encoding: 'utf8',
      cwd: repoRoot,
    })
      .split(/\r?\n/)
      .filter(Boolean);
    for (const forbidden of [
      'docs/HISTORY_CLEANUP_PLAN.md',
      'docs/ARCH_HISTORY_CLEANUP_PLAN.md',
      'docs/CLEANUP_DRYRUN_REPORT.md',
      'scripts/check-residual-exposure.sh',
    ]) {
      expect(tracked, `内部处置文档不应入库: ${forbidden}`).not.toContain(forbidden);
    }

    // 但「Git 历史中仍可取回原站素材」这一事实必须在公开文档中如实披露，
    // 不得出现「已完成历史清理」这类虚假表述。
    const readme = read('README.md');
    expect(readme).toContain('Git 历史中仍可取回');
    expect(readme).not.toContain('已完成历史清理');
    expect(readme).not.toContain('原站素材已从历史移除');
  });
});

describe('原站素材不入库（P0-6 关键不变量）', () => {
  /** 读取 Git 实际跟踪的文件列表 */
  const tracked = execFileSync('git', ['ls-files'], {
    encoding: 'utf8',
    cwd: repoRoot,
  })
    .split(/\r?\n/)
    .filter(Boolean);

  it('版本控制中没有任何原站 HTML/CSS/JS 副本', () => {
    const hits = tracked.filter((f) => /^docs\/evidence\/(html|assets)\//.test(f));
    expect(hits, `原站源码副本仍在版本控制中: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('版本控制中没有任何原站参考截图（ref-*.png）', () => {
    const hits = tracked.filter((f) => /(^|\/)ref-[^/]*\.png$/.test(f));
    expect(hits, `原站参考截图仍在版本控制中: ${hits.join(', ')}`).toHaveLength(0);
  });

  it('我方自己产出的截图（local-*.png）仍然保留', () => {
    const hits = tracked.filter((f) => /(^|\/)local-[^/]*\.png$/.test(f));
    expect(hits.length, '我方产出的截图应保留在版本控制中').toBeGreaterThan(0);
  });

  it('.gitignore 的规则覆盖视口子目录（曾经的真实缺陷）', () => {
    // 原规则写作 docs/evidence/screenshots/ref-*.png，
    // 而实际文件在 desktop-1280 / desktop-1920 / mobile-375 子目录里。
    // gitignore 的 * 不跨越目录分隔符 → 那条规则从未命中过，
    // 30 个原站参考截图一直被 Git 跟踪。
    const ignore = read('.gitignore');
    expect(ignore).toContain('docs/evidence/screenshots/**/ref-*.png');
  });

  it('.gitignore 仍然忽略原站 HTML/CSS/JS 目录', () => {
    const ignore = read('.gitignore');
    expect(ignore).toContain('docs/evidence/html/');
    expect(ignore).toContain('docs/evidence/assets/');
  });
});
