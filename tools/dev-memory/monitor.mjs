import { pathToFileURL } from 'node:url';
import { createProcessTable } from './lib/process-table.mjs';
import { ProcessMonitor } from './lib/monitor-core.mjs';
import { LeaseStore } from './lib/ownership-lease.mjs';
import { ReportStore } from './report-store.mjs';
import { machineId } from './lib/worktree.mjs';
import { CliError, optionalInteger, parseArgs, requireString } from './cli-args.mjs';

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv, {
      lease: { type: 'string' },
      report: { type: 'string' },
      'interval-ms': { type: 'string' },
      'timeout-ms': { type: 'string' },
    });
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      return error.exitCode;
    }
    throw error;
  }

  try {
    const leasePath = requireString(parsed.options, 'lease');
    const reportPath = requireString(parsed.options, 'report');
    const intervalMs = optionalInteger(parsed.options, 'interval-ms', 1_000, 100, 10_000);
    const timeoutMs = optionalInteger(parsed.options, 'timeout-ms', 0, 0, 24 * 60 * 60 * 1_000);
    const leaseStore = new LeaseStore();
    const lease = leaseStore.read(leasePath);
    const processTable = createProcessTable();
    const monitor = new ProcessMonitor({ processTable });
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;
    const report = await monitor.run(lease, reportPath, {
      intervalMs,
      machineId: machineId({ platform: process.platform }),
      shouldStop: () => {
        if (deadline !== null && Date.now() >= deadline) return true;
        try {
          return leaseStore.read(leasePath).state !== 'ACTIVE';
        } catch {
          return false;
        }
      },
    });
    process.stdout.write(`${JSON.stringify(report.summary)}\n`);
    return report.summary.monitor_errors.length > 0 ? 3 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 3;
  }
}

if (isMain()) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 3;
  });
}
