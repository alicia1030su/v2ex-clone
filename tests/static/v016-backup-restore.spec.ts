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
 * 2. **恢复侧**：`psql` 没带 `-v ON_ERROR_STOP=1` ⇒
 *    `--single-transaction` 只保证「全成或全回滚」，**不会**因单条失败而中止；
 *    psql 一路报错、最后仍退出 0 ⇒ 脚本判定成功。
 *
 * 换句话说：**这是「报了一堆错却说成功、数据没回来」的假成功**。
 * 它比「报错并失败」危险得多 —— 会让运维以为备份恢复可用。
 *
 * 本护栏锁住这两点，任何一边被改回去都会判红。
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

  it('psql 恢复必须带 ON_ERROR_STOP=1（否则报错也会「成功」）', () => {
    const idx = RESTORE.indexOf('psql');
    expect(idx, '找不到 psql 调用').toBeGreaterThan(0);
    const block = RESTORE.slice(idx, idx + 500);
    expect(
      /ON_ERROR_STOP\s*=\s*1/.test(block),
      'restore.sh 的 psql 缺 `-v ON_ERROR_STOP=1` —— ' +
        '`--single-transaction` 不会因单条失败而中止，' +
        'psql 会一路报错并最终退出 0 ⇒ 脚本打印「恢复完成」但数据没回来',
    ).toBe(true);
  });

  it('恢复失败必须走 die（不得只打日志就继续）', () => {
    const idx = RESTORE.indexOf('ON_ERROR_STOP');
    const tail = RESTORE.slice(idx, idx + 400);
    expect(
      /die\s+/.test(tail),
      '恢复失败分支必须 `die`（非零退出），不能只打印一行日志',
    ).toBe(true);
  });
});
