import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { PAGE_CLASS_SPECS, VIEWPORTS, SEED_TIME_ANCHOR, resolveRoute } from './spec.mjs';
import { prepareFixtures } from './fixtures.mjs';
import { collectOfficialObservations, collectPageEvidence } from './browser-probes.mjs';
import {
  EVIDENCE_ROOT,
  writeGapMetadata,
  writeJson,
  writeReferenceManifest,
  writeSharedEvidence,
} from './evidence-store.mjs';
import { generate } from './generate-matrix.mjs';
import { renderMatrix } from './render-matrix.mjs';
import { validateMatrix } from './validate-matrix.mjs';
import { WorktreeIdentityService, machineId } from '../../dev-memory/lib/worktree.mjs';
import { createProcessTable, confirmedDescendants, verifyProcessIdentity } from '../../dev-memory/lib/process-table.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MATRIX_PATH = path.join(EVIDENCE_ROOT, 'fidelity-matrix.json');
const MARKDOWN_PATH = path.join(ROOT, 'docs', 'VISUAL_FIDELITY_MATRIX_v0.0.21.md');

function isMain() {
  return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function has(name) {
  return process.argv.includes(`--${name}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function roleAccount(role, env) {
  if (role === 'admin') {
    return { username: env.SEED_ADMIN_USERNAME || 'admin', password: env.SEED_ADMIN_PASSWORD };
  }
  if (role === 'moderator') return { username: 'moderator', password: env.SEED_DEMO_PASSWORD };
  if (role === 'user') return { username: 'lisi', password: env.SEED_DEMO_PASSWORD };
  return null;
}

async function createAuditContext(browser, baseUrl, viewport, role, env) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
  });
  const account = roleAccount(role, env);
  if (!account) return context;
  if (!account.password) {
    await context.close();
    throw new Error(`missing test password for role ${role}`);
  }
  const page = await context.newPage();
  try {
    await page.goto(new URL('/signin', baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.fill('#username', account.username);
    await page.fill('#password', account.password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/signin'), { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
  } catch (error) {
    const pageText = await page.locator('body').innerText().catch(() => '').then((text) => text.slice(0, 240));
    throw new Error(`login failed for role ${role}: ${error instanceof Error ? error.message : String(error)}; page=${pageText}`);
  } finally {
    await page.close();
  }
  return context;
}

async function waitForHttp(url, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`managed server exited before becoming ready (${child.exitCode}/${child.signalCode})`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 400) return;
    } catch {
      // Server is still starting.
    }
    await sleep(250);
  }
  throw new Error(`managed server did not become ready: ${url}`);
}

function signalExact(processTable, expected, signal) {
  const fresh = processTable.snapshotOne(expected.pid);
  if (!fresh || !verifyProcessIdentity(expected, fresh, process.platform)) {
    throw new Error(`identity changed before ${signal} for pid ${expected.pid}`);
  }
  processTable.signal(expected.pid, signal);
}

async function stopManagedServer(child, processTable) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const root = processTable.snapshotOne(child.pid);
  if (!root || root.ppid !== process.pid || !verifyProcessIdentity(root, root, process.platform)) {
    throw new Error('managed server root identity is not owned by this audit process');
  }
  const descendants = confirmedDescendants(root, processTable.snapshotFresh())
    .sort((left, right) => right.depth - left.depth);
  for (const entry of descendants) {
    try {
      signalExact(processTable, entry.process, 'SIGTERM');
    } catch (error) {
      if (!/identity changed/.test(error.message)) throw error;
    }
  }
  try {
    signalExact(processTable, root, 'SIGTERM');
  } catch (error) {
    if (!/identity changed/.test(error.message)) throw error;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    await sleep(100);
  }
  if (child.exitCode === null && child.signalCode === null) {
    signalExact(processTable, root, 'SIGKILL');
  }
}

function readEvidenceJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function summarizeLayerEvidence(record, stored) {
  const layerFiles = {
    L1: 'metadata.json',
    L2: 'geometry.json',
    L3: 'styles.json',
    L4: 'dom-aria.json',
    L5: 'interaction.json',
    L6: 'responsive.json',
  };
  const filePath = stored.files[layerFiles[record.layer]];
  const value = readEvidenceJson(filePath);
  const findings = [];
  if (record.layer === 'L1') {
    return { current: { official_comparison: 'unavailable', collection: stored.status }, findings };
  }
  if (record.layer === 'L2') {
    if (value.overflow?.horizontalOverflow === true) findings.push('horizontal-overflow');
    if (value.overlap === true) findings.push('main-rightbar-overlap');
    return { current: { box_count: value.boxes?.length ?? 0, overflow: value.overflow, overlap: value.overlap }, findings };
  }
  if (record.layer === 'L3') {
    return { current: { style_count: value.length, sample: value.slice(0, 8) }, findings };
  }
  if (record.layer === 'L4') {
    if ((value.unlabeledControls?.length ?? 0) > 0) findings.push('unlabeled-form-controls');
    if ((value.emptyTargets?.length ?? 0) > 0) findings.push('empty-link-or-button');
    return { current: { landmarks: value.landmarks?.length ?? 0, headings: value.headings?.length ?? 0, unlabeled_controls: value.unlabeledControls?.length ?? 0, empty_targets: value.emptyTargets?.length ?? 0 }, findings };
  }
  if (record.layer === 'L5') {
    const ratios = (value.contrastChecks ?? []).map((entry) => entry.ratio).filter(Number.isFinite);
    const minContrast = ratios.length ? Math.min(...ratios) : null;
    if (minContrast !== null && minContrast < 4.5) findings.push('contrast-below-4.5');
    if (value.focus?.active === false) findings.push('focus-not-active');
    return { current: { min_contrast: minContrast, focus: value.focus ?? null, keyboard_tab: value.keyboardTab ?? null, reduced_motion: value.reducedMotion }, findings };
  }
  if (value.overflow?.horizontalOverflow === true || value.horizontalOverflow === true) findings.push('horizontal-overflow');
  if ((value.missingImages?.length ?? 0) > 0) findings.push('missing-images');
  return { current: { viewport: value.viewport, overflow: value.overflow, missing_images: value.missingImages?.length ?? 0, theme: value.theme, zoom200: value.zoom200 }, findings };
}

function emptyEvidence(reason) {
  return {
    status: 'collection-error',
    finalUrl: null,
    httpStatus: null,
    layoutStable: false,
    consoleErrors: [reason],
    geometry: { boxes: [], overlap: null, overflow: { horizontalOverflow: null } },
    styles: [],
    domAria: { title: null, landmarks: [], headings: [], unlabeledControls: [], emptyTargets: [] },
    interaction: { observed: {}, contrastChecks: [], reducedMotion: false },
    responsive: { viewport: null, overflow: { horizontalOverflow: null }, missingImages: [], theme: null },
  };
}

/**
 * Run the complete before audit. Official pixel fidelity remains UNVERIFIED;
 * a zero exit code means collection/validation completed, not visual parity.
 *
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function runAudit(options = {}) {
  const worktree = new WorktreeIdentityService().resolve(options.worktree ?? ROOT);
  dotenv.config({ path: options.envFile ?? path.join(ROOT, '.env.test'), quiet: true });
  const capturedAt = new Date().toISOString();
  const phase = options.phase === 'after' ? 'after' : 'before';
  const fixtures = options.skipFixtures
    ? { topicId: 1, nodeName: 'claude', username: 'admin', tagName: 'visual-audit', query: 'claude', replyMode: 'classic', fingerprint: 'not-prepared' }
    : await prepareFixtures({ envFile: options.envFile });
  if (phase === 'before') {
    generate({
      worktree: worktree.root,
      output: MATRIX_PATH,
      commit: worktree.git_head,
      capturedAt,
      fixtures,
    });
  } else if (!fs.existsSync(MATRIX_PATH)) {
    throw new Error('after audit requires an existing before matrix');
  }

  const baseUrl = options.baseUrl ?? (options.managedServer ? 'http://127.0.0.1:3210' : null);
  if (!baseUrl) throw new Error('provide --base-url or --managed-server');
  const processTable = createProcessTable();
  const env = {
    ...process.env,
    APP_NOW: SEED_TIME_ANCHOR,
    SEED_TIME_ANCHOR,
    APP_RUNTIME_ENV: 'test',
    TEST_ENV_ISOLATED: '1',
    DISABLE_CAPTCHA: '1',
    APP_URL: baseUrl,
    NEXT_PUBLIC_APP_URL: baseUrl,
  };
  let server = null;
  if (options.managedServer) {
    server = spawn(process.execPath, [
      path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      '-p',
      '3210',
    ], {
      cwd: worktree.root,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.resume();
    server.stderr.resume();
    await waitForHttp(baseUrl, server);
  }

  const channel = process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : null);
  const browser = await chromium.launch(channel ? { channel } : {});
  const browserVersion = browser.version();
  const environment = {
    commit: worktree.git_head,
    tree: worktree.git_tree,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    machine_id: machineId({ platform: process.platform }),
    browser: 'chromium',
    browser_version: browserVersion,
    channel: channel ?? 'bundled-chromium',
    locale: 'zh-CN',
    dpr: 1,
    theme: 'light',
    seed_time_anchor: SEED_TIME_ANCHOR,
    fixture_fingerprint: fixtures.fingerprint,
    base_url: baseUrl,
    scope: options.managedServer ? 'managed-next-start-process-tree' : 'audit-process-tree-only',
  };
  const runDirectory = path.join(EVIDENCE_ROOT, 'runs', capturedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(runDirectory, { recursive: true });
  writeJson(path.join(runDirectory, 'environment.json'), environment);
  const officialObservationsPath = path.join(runDirectory, 'official-observations.json');
  const officialObservations = [];
  const officialContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    colorScheme: 'light',
  });
  try {
    for (const url of ['https://www.v2ex.com/', 'https://livid.v2ex.com/design.html']) {
      const page = await officialContext.newPage();
      try {
        officialObservations.push(await collectOfficialObservations(page, url));
      } catch (error) {
        officialObservations.push({
          url,
          status: 'unavailable',
          captured_at: new Date().toISOString(),
          legal_basis: 'Public official page could not be observed; no source or assets copied.',
          eligible_for_official_pixel_claim: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await officialContext.close();
  }
  writeJson(officialObservationsPath, officialObservations);
  let referenceManifestPath = writeReferenceManifest({
    commit: worktree.git_head,
    environment,
    capturedAt,
    officialObservationsPath,
    fileName: phase === 'before' ? 'reference-manifest.json' : 'reference-manifest-after.json',
  });
  const shared = new Map();
  const rawProbes = [];
  const consoleErrors = [];
  const selectedPages = options.maxPageClasses
    ? PAGE_CLASS_SPECS.slice(0, Math.max(1, Math.min(18, options.maxPageClasses)))
    : PAGE_CLASS_SPECS;

  try {
    for (const viewport of VIEWPORTS) {
      const contexts = new Map();
      try {
        const requiredRoles = new Set(selectedPages.flatMap((pageClass) => pageClass.roles));
        for (const role of requiredRoles) {
          contexts.set(role, await createAuditContext(browser, baseUrl, viewport, role, env));
        }
        for (const pageClass of selectedPages) {
          const variants = pageClass.slug === 'reply-modes'
            ? ['classic', 'quote', 'badge', 'nested', 'tree', 'lines', 'excerpt']
            : ['default'];
          for (const role of pageClass.roles) {
            const context = contexts.get(role);
            for (const variant of variants) {
              const routeFixtures = variant === 'default' ? fixtures : { ...fixtures, replyMode: variant };
              const route = resolveRoute(pageClass.routes[0], routeFixtures);
              const page = await context.newPage();
              let evidence;
              try {
                evidence = await collectPageEvidence(page, {
                  url: new URL(route, baseUrl).toString(),
                  pageClass: pageClass.slug,
                  states: pageClass.states,
                  screenshotPath: path.join(EVIDENCE_ROOT, phase, '_shared', pageClass.slug, viewport.name, role, ...(variant === 'default' ? [] : [variant]), 'page.png'),
                });
              } catch (error) {
                evidence = emptyEvidence(error instanceof Error ? error.message : String(error));
              } finally {
                await page.close();
              }
              const stored = writeSharedEvidence({
                pageClass,
                viewport,
                role,
                phase,
                variant,
                evidence,
                environment,
                commit: worktree.git_head,
                capturedAt,
              });
              shared.set(`${pageClass.slug}|${viewport.name}|${role}|${variant}`, stored);
              rawProbes.push({ page_class: pageClass.slug, auth_role: role, viewport: viewport.name, variant, route, final_url: evidence.finalUrl, status: evidence.status, layout_stable: evidence.layoutStable });
              consoleErrors.push(...evidence.consoleErrors.map((error) => ({ page_class: pageClass.slug, auth_role: role, viewport: viewport.name, variant, error })));
            }
          }
        }
      } finally {
        for (const context of contexts.values()) await context.close();
      }
    }
  } finally {
    await browser.close();
    if (server) await stopManagedServer(server, processTable);
    processTable.impl?.dispose?.();
  }

  const rawProbesPath = path.join(runDirectory, 'raw-probes.json');
  writeJson(rawProbesPath, rawProbes);
  writeJson(path.join(runDirectory, 'console-errors.json'), consoleErrors);
  referenceManifestPath = writeReferenceManifest({
    commit: worktree.git_head,
    environment,
    capturedAt,
    baselinePath: rawProbesPath,
    officialObservationsPath,
    fileName: phase === 'before' ? 'reference-manifest.json' : 'reference-manifest-after.json',
  });
  const records = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));
  for (const record of records) {
    const prefix = `${record.page_class}|${record.viewport}|`;
    const storedEntries = [...shared.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value);
    const stored = storedEntries[0];
    if (!stored) {
      throw new Error(`missing shared evidence for ${record.page_class}/${record.viewport}; do not use --max-page-classes for final audit`);
    }
    record.probe_results = record.probe_results.map((probe) => {
      const fileName = {
        L1: 'metadata.json',
        L2: 'geometry.json',
        L3: 'styles.json',
        L4: 'dom-aria.json',
        L5: 'interaction.json',
        L6: 'responsive.json',
      }[record.layer];
      return { ...probe, evidence: path.relative(ROOT, stored.files[fileName]).split(path.sep).join('/') };
    });
    const summary = summarizeLayerEvidence(record, stored);
    if (phase === 'after') {
      record.before_classification = record.classification;
      record.before_findings = [...(record.delta?.findings ?? [])];
    }
    record.current_value = {
      ...summary.current,
      official_comparison: 'unavailable',
      role_coverage: storedEntries.map((entry) => ({ role: entry.role, status: entry.status })),
    };
    record.delta = {
      status: summary.findings.length ? 'internal-gap-observed' : 'not-comparable',
      reason: summary.findings.length ? summary.findings.join(',') : 'NO_ELIGIBLE_OFFICIAL_PIXEL_REFERENCE',
      findings: summary.findings,
    };
    record.classification = summary.findings.length > 0 ? 'A' : 'E';
    if (summary.findings.length > 0) {
      record.notes = `${record.notes} Internal ${phase}-evidence findings: ${summary.findings.join(', ')}.`;
    } else {
      record.notes = `${record.notes} Internal ${phase}-evidence findings: none.`;
    }
    record.retest_result = `${phase}-collected`;
    const evidencePath = writeGapMetadata({
      record,
      shared: storedEntries,
      referenceManifestPath,
      environment,
      phase,
    });
    const relativeEvidencePath = path.relative(ROOT, evidencePath).split(path.sep).join('/');
    if (phase === 'after') {
      record.evidence_after = relativeEvidencePath;
      record.retest_result = 'after-collected';
    } else {
      record.evidence_before = relativeEvidencePath;
      record.retest_result = `${phase}-collected`;
    }
  }
  writeJson(MATRIX_PATH, records);
  renderMatrix(MATRIX_PATH, MARKDOWN_PATH);
  const validation = await validateMatrix(MATRIX_PATH);
  return {
    ok: true,
    phase,
    commit: worktree.git_head,
    records: records.length,
    collected_role_page_viewports: shared.size,
    official_observations: officialObservations.map((entry) => ({ url: entry.url, status: entry.status })),
    console_errors: consoleErrors.length,
    p0_blocking: validation.p0Blocking,
    matrix: MATRIX_PATH,
    markdown: MARKDOWN_PATH,
    run_directory: runDirectory,
  };
}

if (isMain()) {
  runAudit({
    baseUrl: argument('base-url'),
    managedServer: has('managed-server'),
    skipFixtures: has('skip-fixtures'),
    phase: argument('phase', 'before'),
    envFile: argument('env-file'),
    maxPageClasses: argument('max-page-classes') ? Number(argument('max-page-classes')) : null,
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
