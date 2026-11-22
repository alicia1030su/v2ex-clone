import { describe, expect, it } from 'vitest';
import {
  LinuxProcessTable,
  parseLinuxStat,
} from '../../tools/dev-memory/lib/process-table-linux.mjs';
import {
  parseCimDate,
  parseWindowsSnapshot,
} from '../../tools/dev-memory/lib/process-table-windows.mjs';
import {
  confirmedDescendants,
  verifyProcessIdentity,
} from '../../tools/dev-memory/lib/process-table.mjs';

describe('cross-platform process-table parsers', () => {
  it('parses a Linux stat record whose comm contains spaces and parentheses', () => {
    const parsed = parseLinuxStat(
      '4242 (odd node (worker)) S 4100 4242 4242 0 -1 4194560 100 0 0 0 5 7 0 0 20 0 12 0 987654 1638400 250\n',
      4242,
    );

    expect(parsed).toMatchObject({
      pid: 4242,
      name: 'odd node (worker)',
      ppid: 4100,
      start_ticks: 987654,
      rss_pages: 250,
    });
  });

  it('reads Linux exe/cwd and marks an unreadable cwd UNKNOWN', () => {
    const files = new Map([
      ['/proc/4242/stat', '4242 (node) S 4100 4242 4242 0 -1 0 0 0 0 0 0 0 0 0 20 0 12 0 987654 1638400 250\n'],
      ['/proc/stat', 'cpu  1 2 3\nbtime 1767225600\n'],
    ]);
    const fakeFs = {
      existsSync: (filePath) => files.has(filePath),
      readFileSync: (filePath) => {
        const value = files.get(String(filePath));
        if (value === undefined) throw new Error('ENOENT');
        return value;
      },
      readlinkSync: (filePath) => {
        if (String(filePath).endsWith('/exe')) return '/usr/bin/node';
        throw new Error('EPERM');
      },
      readdirSync: () => ['4242'],
    };
    const table = new LinuxProcessTable({ fs: fakeFs });
    const processInfo = table.snapshotOne(4242);

    expect(processInfo).toMatchObject({
      pid: 4242,
      ppid: 4100,
      name: 'node',
      exe: '/usr/bin/node',
      cwd: 'UNKNOWN',
      start_ticks: 987654,
      rss_mb: 1,
    });
    expect(processInfo?.start_time).toBe(new Date(1767225600_000 + 9_876_540).toISOString());
    expect(processInfo?.identity_hash).toMatch(/^sha256:/);
  });

  it('parses fixed Windows CIM JSON and CIM dates', () => {
    const cimEpoch = Date.parse('2026-01-01T02:03:04.000Z');
    const raw = JSON.stringify({
      schema: 'workbuddy-dev-memory/process-table-windows/v1',
      processes: [
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'node.exe',
          ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
          CreationDate: '2026-01-01T02:03:04.0000000Z',
          WorkingSetSize: 104857600,
        },
        {
          ProcessId: 901,
          ParentProcessId: 900,
          Name: 'node.exe',
          ExecutablePath: null,
          CreationDate: `/Date(${cimEpoch})/`,
          WorkingSetSize: 0,
        },
      ],
    });

    expect(parseCimDate(`/Date(${cimEpoch})/`)).toBe('2026-01-01T02:03:04.000Z');
    const rows = parseWindowsSnapshot(`\uFEFF${raw}`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      pid: 900,
      ppid: 800,
      exe: 'C:\\Program Files\\nodejs\\node.exe',
      cwd: 'UNKNOWN',
      start_ticks: null,
      rss_mb: 100,
    });
    expect(rows[0].identity_hash).toMatch(/^sha256:/);
  });

  it('selects descendants only through the current PPID chain', () => {
    const processes = [
      { pid: 10, ppid: 1, identity_hash: 'root' },
      { pid: 11, ppid: 10, identity_hash: 'child' },
      { pid: 12, ppid: 11, identity_hash: 'grandchild' },
      { pid: 13, ppid: 99, identity_hash: 'outside' },
    ];
    const descendants = confirmedDescendants(processes[0], processes);

    expect(descendants.map((entry) => entry.process.pid)).toEqual([11, 12]);
    expect(descendants.map((entry) => entry.depth)).toEqual([1, 2]);
  });

  it('rejects a recycled PID whose start time or executable changed', () => {
    const expected = {
      pid: 10,
      ppid: 1,
      start_time: '2026-01-01T00:00:00.000Z',
      start_ticks: 100,
      exe: '/usr/bin/node',
    };
    expect(verifyProcessIdentity(expected, { ...expected }, 'linux')).toBe(true);
    expect(verifyProcessIdentity(expected, { ...expected, start_ticks: 101 }, 'linux')).toBe(false);
    expect(verifyProcessIdentity(expected, { ...expected, exe: '/bin/other' }, 'linux')).toBe(false);
    expect(verifyProcessIdentity(expected, {
      ...expected,
      exe: 'C:\\NODE.EXE',
    }, 'win32')).toBe(false);
  });
});
