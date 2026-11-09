import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  LEGACY_NODE_LIST_FIELDS,
  parseLegacyFields,
  projectLegacyNode,
  resolveLegacyNodeSort,
} from '../../src/lib/legacy-node-list';
import { parseLegacyId } from '../../src/lib/legacy-topic-api';
import {
  LEGACY_CACHE_SECONDS,
  LEGACY_HOT_LIMIT,
  LEGACY_LATEST_LIMIT,
  LEGACY_LIST_LIMIT,
  LEGACY_RATE_LIMIT,
} from '../../src/lib/legacy-constants';

/**
 * v0.0.13（V13-02/03/04）：**补齐的三个旧版端点**的契约护栏
 *
 * 上一轮（PR #45/#46）声称「原站旧版端点已全量核对」，但 2026-11-09
 * 复核发现 `/api/topics/hot.json`、`/api/replies/show.json` 仍返回 200，
 * `/api/nodes/list.json` 带齐参数也返回 200（裸路径是 400 而非 404）。
 * 本文件把这些实测契约钉死，防止有人再「顺手修正」成看起来更合理的行为。
 *
 * 逐项（URL / 参数 / 优先级 / 缺参 / 不存在 / 状态码 / 类型 / 字段 /
 * 空值 / 排序 / 限制 / Content-Type / Cache-Control / 限流 / 认证 / 隐私）
 * 的完整核对表见 `docs/LEGACY_API_MATRIX_v0.0.13.md`。
 */

const ROOT = path.resolve(__dirname, '../..');
// 静态护栏必须**行尾无关**：CI 是 LF，Windows 本机 core.autocrlf=true 时是 CRLF。
// 不归一化时，`toContain('a\n    ? b')` 这类多行断言会在本机假红、在 CI 假绿。
const read = (p: string) =>
  readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

describe('旧版端点常量（实测值，不得「顺手调整」）', () => {
  it('条数：show 10 / latest 35 / hot 10', () => {
    expect(LEGACY_LIST_LIMIT).toBe(10);
    expect(LEGACY_LATEST_LIMIT).toBe(35);
    expect(LEGACY_HOT_LIMIT).toBe(10);
  });

  it('配额 600/小时/IP', () => {
    expect(LEGACY_RATE_LIMIT).toBe(600);
  });

  it('Cache-Control 秒数逐项对齐原站实测', () => {
    expect(LEGACY_CACHE_SECONDS).toMatchObject({
      topicsShow: 120,
      topicsLatest: 120,
      topicsHot: 120,
      repliesShow: 60,
      membersShow: 600,
      nodesShow: 3600,
      nodesAll: 7200,
      nodesList: 30,
      feedAtom: 600,
      feedJson: 1800,
    });
  });
});

describe('/api/nodes/list.json —— 参数与投影', () => {
  it('fields 解析：逗号分隔、去空白、去空项、保留顺序', () => {
    expect(parseLegacyFields('id,name, title')).toEqual(['id', 'name', 'title']);
    expect(parseLegacyFields(' , ,')).toEqual([]);
    expect(parseLegacyFields(null)).toEqual([]);
  });

  it('sort_by 映射照抄原站（reverse 实测不生效）', () => {
    expect(resolveLegacyNodeSort('id')).toBe('id');
    expect(resolveLegacyNodeSort('name')).toBe('name');
    expect(resolveLegacyNodeSort('topics')).toBe('other');
    expect(resolveLegacyNodeSort('bogus')).toBe('other');
  });

  it('投影只输出请求字段；未知字段仍然存在且值为 null', () => {
    const record = { id: 3, name: 'python', title: 'Python', stars: 5 };
    expect(projectLegacyNode(record, ['id', 'stars'])).toEqual({ id: 3, stars: 5 });
    expect(projectLegacyNode(record, ['bogus'])).toEqual({ bogus: null });
    expect(projectLegacyNode(record, ['id', 'id'])).toEqual({ id: 3 });
  });

  it('可投影字段集合覆盖旧版 16 键 + created', () => {
    expect(LEGACY_NODE_LIST_FIELDS).toContain('created');
    expect(LEGACY_NODE_LIST_FIELDS).toContain('topics');
    expect(LEGACY_NODE_LIST_FIELDS).toContain('stars');
    expect(LEGACY_NODE_LIST_FIELDS.length).toBeGreaterThanOrEqual(17);
  });

  it('路由：三参数缺一即 400，且带齐后才查库', () => {
    const route = read('src/app/api/nodes/list.json/route.ts');
    expect(route).toContain("url.searchParams.get('fields')");
    expect(route).toContain("url.searchParams.get('sort_by')");
    expect(route).toContain("url.searchParams.get('reverse')");
    // v0.0.13 P2-7：400 也回写限流三元组，故调用改为 legacyBadRequest(rl)。
    // 这里只钉「必须调用该函数」，不钉参数形式，避免与限流头改进互相锁死。
    expect(route).toMatch(/legacyBadRequest\(/);
    expect(route).toContain("application/json;charset=utf-8");
  });
});

describe('/api/replies/show.json —— 异常参数一律 200 []', () => {
  it('topic_id 复用 parseLegacyId（同名取最后一个）', () => {
    expect(parseLegacyId(['1', '2'])).toBe(2);
    expect(parseLegacyId([])).toBeNull();
    expect(parseLegacyId(['abc'])).toBeNull();
    expect(parseLegacyId(['0'])).toBeNull();
    expect(parseLegacyId(['999999999'])).toBe(999999999);
  });

  it('路由：无参数 / 非法参数返回空数组而不是 404', () => {
    const route = read('src/app/api/replies/show.json/route.ts');
    expect(route).toContain("parseLegacyId(url.searchParams.getAll('topic_id'))");
    expect(route).toContain('topicId === null\n    ? []');
    expect(route).not.toContain('legacyNotFoundResponse');
  });

  it('静态护栏的读取必须行尾无关（CRLF 不得造成本机假红 / CI 假绿）', () => {
    // 真实故障（2026-11-09 本机）：`git reset --hard` 后 13/14 个静态 spec
    // 变成 CRLF（core.autocrlf=true，仓库无 .gitattributes 约定），
    // `expect(route).toContain('topicId === null\n    ? []')` 立刻假红；
    // 而 CI 是 LF ⇒ 同一个断言在 CI 恒绿。这类「只在某一侧成立」的护栏
    // 比没有护栏更危险，因为它会被人当成噪音忽略掉。
    const dir = path.join(ROOT, 'tests', 'static');
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.spec.ts'))) {
      const src = readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      const start = src.indexOf('const read =');
      if (start < 0) continue;
      // ⚠️ 不能「匹配不上就跳过」—— 那等于给未识别写法发免检通行证（假绿）。
      //    这里取 `const read =` 之后 300 字符（足够覆盖多行 helper），
      //    只要这段里没有归一化就判红，不管它写成什么形态。
      const snippet = src.slice(start, start + 300);
      if (!/readFileSync\(/.test(snippet)) {
        offenders.push(`${f}（read helper 未使用 readFileSync，需人工确认）`);
        continue;
      }
      if (!/\.replace\(\/\\r\\n\/g,\s*'\\n'\)/.test(snippet)) {
        offenders.push(f);
      }
    }
    expect(offenders, `这些静态 spec 的 read() 未归一化行尾：\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('分页参数被忽略：路由不读取 page / page_size', () => {
    const route = read('src/app/api/replies/show.json/route.ts');
    expect(route).not.toContain("get('page')");
    expect(route).not.toContain("get('page_size')");
  });
});

describe('/api/topics/hot.json —— 按回复数降序、忽略所有查询参数', () => {
  it('路由使用共用装配器且只按 hot 过滤', () => {
    const route = read('src/app/api/topics/hot.json/route.ts');
    expect(route).toContain("kind: 'hot'");
    expect(route).toContain('LEGACY_HOT_LIMIT');
    expect(route).toContain('loadLegacyTopics');
    expect(route).not.toContain('searchParams');
  });

  it('装配器对 hot 使用 replies 降序 + id 兜底（排序确定性）', () => {
    const src = read('src/server/legacy-topics.ts');
    expect(src).toContain("filter.kind === 'hot'");
    expect(src).toContain('desc(schema.topics.repliesCount)');
    expect(src).toContain('desc(schema.topics.id)');
  });
});

describe('三个新端点都接入限流，且不使用不安全的 SQL 构造', () => {
  const routes = [
    'src/app/api/topics/hot.json/route.ts',
    'src/app/api/replies/show.json/route.ts',
    'src/app/api/nodes/list.json/route.ts',
  ];
  it.each(routes)('%s 有 guardLegacyRateLimit 且无 sql.raw(', (file) => {
    const src = read(file);
    expect(src).toContain('guardLegacyRateLimit(');
    expect(src).not.toContain('sql.raw(');
  });
});
