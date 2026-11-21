import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * v0.0.16 备份/恢复：必须能**真的**覆盖式恢复，且失败不得伪装成功
 * ============================================================================
 *
 * ## 这条护栏来自一次真实事故（V16-11）
 *
 * 候选验收 run `44336440087` 里做了这样一件事：
 *   备份 → 删掉 1 条回复 → 从备份恢复 → 比对数据量
 * 结果是 `replies=35 → 34`：**数据没回来**。而 `restore.sh` 打印了
 * 「恢复完成」，退出码 0。
 *
 * 日志里真实的错误是：
 *
 *     ERROR:  schema "drizzle" already exists
 *     ERROR:  current transaction is aborted, commands ignored until end of transaction block
 *     …（后续全部被跳过）
 *     [成功] 恢复完成
 *
 * ### 两个独立的原因，缺一不可
 *
 * 1. **备份侧**：`pg_dump` 没带 `--clean --if-exists` ⇒ dump 里只有
 *    `CREATE TABLE` / `CREATE SCHEMA`，恢复到**已有对象**的库上必然撞车。
 * 2. **恢复侧**：旧实现用 `psql` 且没有 `ON_ERROR_STOP=1`，导致单条失败后
 *    仍继续执行并最终退出 0。v0.0.20 改为 custom-format dump +
 *    `pg_restore --single-transaction --exit-on-error`，任一恢复调用失败都必须
 *    进入 `die` 分支。
 *
 * 换句话说：**这是「报了一堆错却说成功、数据没回来」的假成功**。
 * 它比「报错并失败」危险得多 —— 会让运维以为备份恢复可用。
 *
 * 本护栏锁住这些性质，任何一边被改回去都会判红。
 */

const ROOT = path.resolve(__dirname, '..', '..');
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}
function stripShellComments(src: string): string {
  return src
    .replace(/^\s*#.*$/gm, '')
    .replace(/\s+#[^\n]*$/gm, '');
}

describe('v0.0.16 备份/恢复：必须能真正覆盖式恢复', () => {
  const BACKUP = stripShellComments(read('deploy/backup.sh'));
  const RESTORE = stripShellComments(read('deploy/restore.sh'));

  it('pg_dump 必须带 --clean --if-exists（否则恢复到已有库必然撞车）', () => {
    expect(
      BACKUP.includes('--clean'),
      'backup.sh 的 pg_dump 缺 `--clean` —— 恢复到已有对象的库上会报 ' +
        '`schema "drizzle" already exists` 并**静默丢数据**',
    ).toBe(true);
    expect(
      BACKUP.includes('--if-exists'),
      'backup.sh 的 pg_dump 缺 `--if-exists` —— 首次恢复到空库时 `DROP` 会报错',
    ).toBe(true);

    // 判据要锚在 pg_dump 那一行附近，不能被别处的同名词蒙过
    const idx = BACKUP.indexOf('pg_dump');
    expect(idx, '找不到 pg_dump 调用').toBeGreaterThan(0);
    const block = BACKUP.slice(idx, idx + 400);
    expect(block, '`--clean --if-exists` 必须出现在 pg_dump 的参数里').toMatch(
      /--clean[\s\S]{0,80}--if-exists/,
    );
  });

  it('custom dump 恢复必须带 --single-transaction 与 --exit-on-error', () => {
    let cursor = 0;
    let restoreCalls = 0;
    while ((cursor = RESTORE.indexOf('pg_restore', cursor)) >= 0) {
      restoreCalls += 1;
      const block = RESTORE.slice(cursor, cursor + 700);
      expect(
        block.includes('--single-transaction'),
        `第 ${restoreCalls} 个 pg_restore 调用缺 --single-transaction`,
      ).toBe(true);
      expect(
        block.includes('--exit-on-error'),
        `第 ${restoreCalls} 个 pg_restore 调用缺 --exit-on-error`,
      ).toBe(true);
      expect(
        /die\s+/.test(block),
        `第 ${restoreCalls} 个 pg_restore 失败分支必须 die（非零退出）`,
      ).toBe(true);
      cursor += 'pg_restore'.length;
    }
    expect(restoreCalls, 'restore.sh 应包含 scratch 与目标两次 pg_restore 调用').toBe(2);
  });
});
