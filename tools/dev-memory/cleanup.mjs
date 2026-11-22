import { pathToFileURL } from 'node:url';
import { createProcessTable } from './lib/process-table.mjs';
import { LeaseStore } from './lib/ownership-lease.mjs';
import { ProtectedProcessRegistry } from './lib/protected-registry.mjs';
import { SafeCleaner } from './lib/safe-cleaner.mjs';
import { ReportStore } from './report-store.mjs';
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
      reason: { type: 'string' },
      'outside-probe-pid': { type: 'string' },
      artifact: { type: 'multiple' },
      'grace-ms': { type: 'string' },
    });
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message);
      return error.exitCode;
    }
    throw error;
  }

  const reportStore = new ReportStore();
  try {
    const leasePath = requireString(parsed.options, 'lease');
    const reportPath = requireString(parsed.options, 'report');
    const reason = typeof parsed.options.reason === 'string' ? parsed.options.reason : 'manual';
    const outsideProbePid = optionalInteger(parsed.options, 'outside-probe-pid', 0, 1, 2_147_483_647);
    const graceMs = optionalInteger(parsed.options, 'grace-ms', 1_000, 0, 60_000);
    const artifacts = Array.isArray(parsed.options.artifact) ? parsed.options.artifact : [];
    const leaseStore = new LeaseStore({ reportStore });
    const lease = leaseStore.read(leasePath);
    const processTable = createProcessTable();
    const protectedRegistry = new ProtectedProcessRegistry({ processTable });
    const cleaner = new SafeCleaner({
      processTable,
      protectedRegistry,
      leaseStore,
      reportStore,
    });
    const report = await cleaner.cleanup(lease, reason, {
      leasePath,
      outsideProbePid: outsideProbePid || undefined,
      artifacts,
      graceMs,
    });
    reportStore.writeAtomic(reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.decision === 'ABORTED' ? 4 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 4;
  }
}

if (isMain()) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 4;
  });
}
