import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.17 P0-1 运维后台：口径诚实性 + 权限 + 敏感信息
 * ============================================================================
 *
 * ## 这组护栏防的三件事
 *
 * ### ① 把「本进程计数」呈现成「全站总量」
 *
 * `/api/admin/ops` 的计数存在 `globalThis`（进程内）。多副本部署时每个实例
 * 各自计数，接口返回的**不是**集群总量。如果界面只渲染数字而不标注口径，
 * 运维人员会据此判断「全站 QPS 只有 30」，而真实可能是 30×N。
 *
 * ⇒ 后端必须返回 `scope`（process / since-start / instanceId / uptime），
 *   前端必须**渲染**它。只返回不渲染 = 白做。
 *
 * ### ② 为不存在的指标编一个状态
 *
 * 「备份验证状态 / 上次成功时间」在应用容器内**没有数据源**
 * （`backup.sh` 跑在宿主机，产物不在容器里，也没有落盘记录）。
 * 这种情况下界面**必须显示「无数据源」**，不能写「最近备份：正常」。
 *
 * ### ③ 权限从「内容级」退化成「入口级」
 *
 * 运维数据是基础设施面（错误路由分布、磁盘剩余、连接数）。它原先挂在
 * `config.view`（版主可见）上 —— 版主不需要也不应看到这些。
 * v0.0.17 收紧为 `ops.view`（仅 admin），且 tab 在权限不足时**不出现**。
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** 去掉注释，避免「注释里写了」被当成「实现了」 */
function stripTs(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+\/\/[^\n]*$/gm, '');
}

const OPS_ROUTE = stripTs(read('src/app/api/admin/ops/route.ts'));
const CONSOLE_SRC = stripTs(read('src/components/AdminConsole.tsx'));
const PERMISSIONS = stripTs(read('src/lib/permissions.ts'));

describe('v0.0.17 运维后台：指标口径必须诚实', () => {
  it('接口必须返回 scope（process / since-start / 实例身份）', () => {
    // 三个字段缺任何一个，界面都无法说明「这是谁的计数」
    expect(OPS_ROUTE, '接口未声明 metrics 口径为 process').toMatch(/metrics:\s*'process'/);
    expect(OPS_ROUTE, '接口未声明累加窗口为 since-start').toMatch(/window:\s*'since-start'/);
    expect(OPS_ROUTE).toContain('instanceId');
    expect(OPS_ROUTE).toContain('uptimeSeconds');
    expect(OPS_ROUTE).toContain('startedAt');
  });

  it('接口必须返回 warnings，且明确写「不是集群总量」', () => {
    expect(OPS_ROUTE).toContain('warnings');
    expect(OPS_ROUTE).toMatch(/不是集群总量/);
    expect(OPS_ROUTE).toMatch(/逐实例|多副本/);
  });

  it('前端必须**渲染**口径，而不是只接收', () => {
    // 关键：后端有 scope + 前端没渲染 = 等于没做
    /*
     * ⚠️ 必须用**带引号的完整属性值**，不能用子串。
     * 第一版写 `toContain('ops-scope-banner')`，把它改名成
     * `ops-scope-banner-removed` 的负向对照**仍然通过** ——
     * 因为前者是后者的子串。判据过松，等于没锁。
     */
    expect(CONSOLE_SRC).toContain('data-testid="ops-scope-banner"');
    expect(CONSOLE_SRC).toMatch(/本进程/);
    expect(CONSOLE_SRC).toMatch(/进程启动至今/);
    expect(CONSOLE_SRC).toMatch(/ops\.warnings\.map/);
    expect(CONSOLE_SRC).toMatch(/ops\.scope\.instanceId/);
  });

  it('多副本声明存在时，界面必须额外提示「只代表本实例」', () => {
    expect(CONSOLE_SRC).toMatch(/replicasDeclared/);
    expect(CONSOLE_SRC).toMatch(/只代表本实例/);
  });
});

describe('v0.0.17 运维后台：不得伪造不存在的指标', () => {
  it('备份状态无数据源时必须 available:false 且给出原因', () => {
    expect(OPS_ROUTE, '备份状态未声明无数据源').toMatch(/available:\s*false/);
    expect(OPS_ROUTE).toContain('no_data_source');
  });

  it('前端在无数据源时必须显示「无数据源」，不得渲染假的成功时间', () => {
    expect(CONSOLE_SRC).toContain('ops-backup-unavailable');
    expect(CONSOLE_SRC).toMatch(/无数据源/);
    // 反向断言：不得出现「上次备份成功」这类编造文案
    expect(CONSOLE_SRC, '界面出现了编造的备份成功文案').not.toMatch(/上次备份成功|最近备份正常|备份健康/);
  });

  it('磁盘不可读取时显示「不可读取」，不得当成 100% 可用', () => {
    expect(CONSOLE_SRC).toMatch(/不可读取/);
  });

  it('Redis 未配置时必须写明「PgKV 降级路径」，不得显示为正常', () => {
    expect(CONSOLE_SRC).toMatch(/PgKV/);
  });
});

describe('v0.0.17 运维后台：权限必须仅 admin', () => {
  it('ops.view 权限存在且只授予 admin', () => {
    expect(PERMISSIONS).toContain("'ops.view'");
    expect(PERMISSIONS, 'ops.view 未限定为仅 admin').toMatch(/'ops\.view':\s*\[\s*'admin'\s*\]/);
  });

  it('运维接口必须用 ops.view 守卫（不是 config.view）', () => {
    expect(OPS_ROUTE).toMatch(/adminGuard\(request,\s*'ops\.view'\)/);
    expect(
      OPS_ROUTE,
      '运维接口又回到 config.view —— 那会让版主看到基础设施面',
    ).not.toMatch(/adminGuard\(request,\s*'config\.view'\)/);
  });

  it('运维 tab 必须对非 admin 隐藏（入口级权限，不是点了才说无权）', () => {
    expect(CONSOLE_SRC).toMatch(/\{\s*key:\s*'ops'[\s\S]{0,120}visibleTo:\s*\[\s*'admin'\s*\]/);
  });

  it('403 的文案必须是「权限不足」，不能显示成「加载失败」', () => {
    expect(CONSOLE_SRC, '403 被当成通用失败 —— 会让版主以为系统坏了').toMatch(/权限不足/);
  });
});

describe('v0.0.17 运维后台：敏感字段必须被排除', () => {
  it('接口不得返回连接串 / 口令 / Cookie / 邮箱', () => {
    // 反向断言：作用域限定在 **返回体构造段**，不是注释里
    const bodyStart = OPS_ROUTE.indexOf('return NextResponse.json({');
    expect(bodyStart, '找不到返回体').toBeGreaterThan(0);
    const body = OPS_ROUTE.slice(bodyStart);

    for (const bad of [
      'DATABASE_URL',
      'REDIS_URL',
      'POSTGRES_PASSWORD',
      'SESSION_SECRET',
      'password',
      'email',
      'cookie',
      'authorization',
    ]) {
      expect(
        body.includes(bad),
        `运维接口返回体里出现敏感字段 "${bad}" —— 运维面板不需要它`,
      ).toBe(false);
    }
  });

  it('pg_stat_activity 只能取聚合值，不得透出 query / client_addr / usename', () => {
    expect(OPS_ROUTE).not.toMatch(/client_addr/);
    expect(OPS_ROUTE).not.toMatch(/\busename\b/);
    expect(OPS_ROUTE, '不得把 SQL 语句本身返回出去').not.toMatch(/pg_stat_activity[\s\S]{0,200}SELECT\s+query/);
  });
});
