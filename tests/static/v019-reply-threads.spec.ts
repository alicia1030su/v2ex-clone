import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

describe('v0.0.19 回复父子数据契约', () => {
  it('迁移只做加法并包含父回复、幂等键、偏好与图片表', () => {
    const sql = read('drizzle/0005_v019_reply_threads.sql');
    expect(sql).toContain('ALTER TABLE replies ADD COLUMN IF NOT EXISTS parent_reply_id integer');
    expect(sql).toContain('ALTER TABLE replies ADD COLUMN IF NOT EXISTS client_request_id varchar(64)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS replies_parent_topic_idx');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS replies_client_request_uidx');
    expect(sql).toContain('FOREIGN KEY (parent_reply_id) REFERENCES replies(id) ON DELETE SET NULL');
    expect(sql).toContain('CHECK (parent_reply_id IS NULL OR parent_reply_id <> id)');
    expect(sql).toContain('v2ex_validate_reply_parent');
    expect(sql).toContain('父回复必须属于同一主题');
    expect(sql).toContain('回复父子关系不能成环');
    expect(sql).toContain("reply_display_mode IN ('classic', 'quote', 'badge', 'nested', 'tree', 'lines', 'excerpt')");
    expect(sql).toContain("theme_preference IN ('light', 'dark', 'system')");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS reply_images');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS rate_limit_sliding_hits');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS rate_limit_sliding_key_time_idx');
  });

  it('journal 与迁移文件按顺序一一对应', () => {
    const journal = JSON.parse(read('drizzle/meta/_journal.json')) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const migrationFiles = readdirSync(path.join(ROOT, 'drizzle'))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort();
    const expectedTags = migrationFiles.map((name) => name.replace(/\.sql$/, ''));

    // 不硬编码“最后一个是 0005”：v0.0.20 起允许继续追加迁移。
    // 不变量是 journal 必须按真实迁移文件顺序完整登记，且 v0.0.19 的 0005 仍在。
    expect(journal.entries.map((entry) => entry.tag)).toEqual(expectedTags);
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      expectedTags.map((_tag, index) => index),
    );
    expect(journal.entries.some((entry) => entry.tag === '0005_v019_reply_threads')).toBe(true);
  });

  it('ORM schema 与迁移字段一致', () => {
    const schema = read('src/db/schema.ts');
    expect(schema).toContain("parentReplyId: integer('parent_reply_id')");
    expect(schema).toContain("clientRequestId: varchar('client_request_id', { length: 64 })");
    expect(schema).toContain("export const userPreferences = pgTable('user_preferences'");
    expect(schema).toContain("export const replyImages = pgTable(");
  });

  it('回复 API 通过统一状态机校验父回复、幂等与图片归属', () => {
    const route = read('src/app/api/replies/route.ts');
    const links = read('src/server/attachment-links.ts');
    expect(route).toContain('loadOwnedReplyByClientRequest');
    expect(route).toContain('PUBLIC_REPLY_CONDITION');
    expect(route).toContain("error: '父回复不存在或不可见'");
    expect(route).toContain('imageIds');
    expect(route).toContain('syncReplyImageLinks');
    expect(links).toContain('eq(schema.replyImages.userId, input.userId)');
    expect(links).toContain('pg_advisory_xact_lock');
    expect(route).toContain('clientRequestId');
    expect(route).toContain('serializeCreatedReply');
    expect(route).toContain('const MAX_REPLY_PARENT_DEPTH = 32');
    expect(route).toContain('回复层级过深');
  });

  it('数据库触发器是父回复同主题约束的第二道防线', () => {
    const sql = read('drizzle/0005_v019_reply_threads.sql');
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF parent_reply_id, topic_id');
    expect(sql).toContain('IF parent_topic <> NEW.topic_id THEN');
    expect(sql).toContain('IF depth > 10000 THEN');
  });
});

describe('v0.0.19 七种回复展示与跨页契约', () => {
  it('客户端完整提供七种模式且默认经典', () => {
    const list = read('src/components/ReplyList.tsx');
    for (const mode of ['classic', 'quote', 'badge', 'nested', 'tree', 'lines', 'excerpt']) {
      expect(list).toContain(`value: '${mode}'`);
    }
    expect(list).toContain("initialMode: ReplyDisplayMode");
    expect(list).toContain('const MAX_LINES_DOM_ITEMS = 1000');
    expect(list).toContain('items.slice(0, MAX_LINES_DOM_ITEMS)');
    const page = read('src/app/t/[id]/page.tsx');
    expect(page).toContain("initialMode={preferences?.replyDisplayMode ?? 'classic'}");
  });

  it('跨页上下文有父链与子回复上限，绝不一次加载整主题', () => {
    const service = read('src/server/reply-threads.ts');
    expect(service).toContain('const MAX_PARENT_CHAIN = 8');
    expect(service).toContain('const MAX_CONTEXT_CHILDREN = 20');
    expect(service).toContain('gt(schema.replies.floor, opts.childCursor ?? 0)');
    expect(service).toContain('PUBLIC_REPLY_CONDITION');
  });

  it('经典模式不渲染父引用，其它模式按契约渲染', () => {
    const list = read('src/components/ReplyList.tsx');
    expect(list).toContain("['quote', 'nested', 'tree', 'excerpt'].includes(mode)");
    expect(list).toContain("mode === 'badge' && parent");
  });

  it('回复按钮在输入后不会覆盖原父目标', () => {
    const list = read('src/components/ReplyList.tsx');
    expect(list).toContain('if (dirty)');
    expect(list).toContain('保留原回复目标');
    expect(list).toContain('onCancelParent={() => setParentTarget(null)}');
  });
});

describe('v0.0.19 无刷新回复与草稿保护', () => {
  it('编辑器支持快捷键、超时核对、幂等重试与失败保留', () => {
    const composer = read('src/components/ReplyComposer.tsx');
    expect(composer).toContain("localStorage.setItem(draftKey, next)");
    expect(composer).toContain('event.ctrlKey || event.metaKey');
    expect(composer).toContain('reconcileTimeout');
    expect(composer).toContain('不会重复回复');
    expect(composer).not.toContain('window.location.reload');
  });

  it('主题页不再使用原生整页回复表单', () => {
    const page = read('src/app/t/[id]/page.tsx');
    expect(page).toContain('<ReplyList');
    expect(page).not.toContain('action="/api/replies"');
  });
});

describe('v0.0.19 图片上传与三态主题', () => {
  it('回复图片拒绝 SVG/MIME 伪造并限制像素与路径', () => {
    const lib = read('src/lib/reply-images.ts');
    expect(lib).toContain('limitInputPixels: MAX_REPLY_IMAGE_PIXELS');
    expect(lib).toContain("^replies\\/\\d+\\/[a-f0-9]{8,64}\\.(png|jpg|webp|gif)$");
    expect(lib).not.toContain('svg');
    const route = read('src/app/api/reply-images/route.ts');
    expect(route).toContain('图片 MIME 类型与真实内容不一致');
    expect(route).toContain('图片扩展名与真实内容不一致');
    expect(route).toContain('cleanupUnusedReplyImages');
  });

  it('首屏主题脚本区分服务端偏好与游客本地偏好', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain('__V2EX_SERVER_THEME__');
    expect(layout).toContain('dataset.effectiveTheme');
    expect(layout).toContain("getUserPreferences(user.id)");
    const toggle = read('src/components/ThemeToggle.tsx');
    expect(toggle).toContain("const OPTIONS: ThemePreference[] = ['light', 'dark', 'system']");
    expect(toggle).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });

  it('发布预演把 workflow_dispatch 版本真实传给脚本', () => {
    const workflow = read('.github/workflows/release-dryrun.yml');
    expect(workflow).toContain('args+=(--version="$INPUT_VERSION")');
    expect(workflow).toContain('node scripts/release/preflight-dryrun.mjs --mode=static "${args[@]}"');
    expect(workflow).toContain('node scripts/release/preflight-dryrun.mjs --mode=notes "${args[@]}"');
  });

  it('v0.0.19 发布触发器与 Notes 基线不引用旧版本结论', () => {
    const release = read('.github/workflows/release.yml');
    expect(release).toContain("      - 'v0.0.19'");
    const template = read('.github/release-notes-template.md');
    expect(template).not.toContain('v0.0.17 → v0.0.18');
    expect(template).not.toContain('docs/TEST_REPORT_v0.0.18.md');
    expect(template).toContain('docs/release-facts.json');
  });

  it('发行一致性优先读取本版本升级报告，不再固定旧文档', () => {
    const script = read('scripts/release/verify-release-consistency.sh');
    expect(script).toContain('docs/UPGRADE_VERIFICATION_v${EXPECT}.md');
    expect(script).toContain('if [ ! -f "$upgrade_report" ]');
    expect(read('docs/UPGRADE_VERIFICATION_v0.0.19.md')).toContain('45 项');
  });

  it('滑动窗口原语在 Redis 与 PostgreSQL 降级实现中都存在', () => {
    const kv = read('src/lib/kv.ts');
    expect(kv).toContain('slidingWindow(key: string, windowSeconds: number, nowMs');
    expect(kv).toContain("ZREMRANGEBYSCORE");
    expect(kv).toContain('pg_advisory_xact_lock');
    expect(kv).toContain('DELETE FROM rate_limit_sliding_hits');
    const limiter = read('src/lib/rate-limit.ts');
    expect(limiter).toContain('export async function rateLimitSliding');
  });
});
