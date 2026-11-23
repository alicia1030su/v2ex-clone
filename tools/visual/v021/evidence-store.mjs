import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ReportStore } from '../../dev-memory/report-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const EVIDENCE_ROOT = path.join(ROOT, 'docs', 'evidence', 'visual', 'v0.0.21');

export function sha256File(filePath) {
  return `sha256:${createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

export function writeJson(filePath, value) {
  new ReportStore().writeAtomic(filePath, value);
}

/**
 * Write shared page/viewport evidence once; all six layer records reference it.
 */
export function writeSharedEvidence({ pageClass, viewport, role = 'guest', phase = 'before', variant = 'default', evidence, environment, commit, capturedAt }) {
  const directory = path.join(EVIDENCE_ROOT, phase, '_shared', pageClass.slug, viewport.name, role, ...(variant === 'default' ? [] : [variant]));
  fs.mkdirSync(directory, { recursive: true });
  const files = {};
  const payloads = {
    'geometry.json': evidence.geometry,
    'styles.json': evidence.styles,
    'dom-aria.json': evidence.domAria,
    'interaction.json': evidence.interaction,
    'responsive.json': evidence.responsive,
  };
  for (const [name, value] of Object.entries(payloads)) {
    const filePath = path.join(directory, name);
    writeJson(filePath, value);
    files[name] = filePath;
  }
  const metadataPath = path.join(directory, 'metadata.json');
  writeJson(metadataPath, {
    schema: 'workbuddy-v021/shared-evidence/v1',
    page_class: pageClass.slug,
    auth_role: role,
    viewport: viewport.name,
    route: evidence.finalUrl,
    status: evidence.status,
    http_status: evidence.httpStatus,
    layout_stable: evidence.layoutStable,
    console_errors: evidence.consoleErrors,
    captured_at: capturedAt,
    commit,
    environment,
  });
  files['metadata.json'] = metadataPath;
  const screenshotPath = path.join(directory, 'page.png');
  if (fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).isFile()) {
    files['page.png'] = screenshotPath;
  }
  return { directory, files, status: evidence.status, role, variant };
}

/**
 * Write one matrix record's before metadata with hashes for every referenced
 * evidence file. The record remains UNVERIFIED when no official reference
 * exists, regardless of whether current probes succeeded.
 */
export function writeGapMetadata({ record, shared, referenceManifestPath, environment, phase = 'before' }) {
  const directory = path.join(EVIDENCE_ROOT, phase, record.gap_id);
  fs.mkdirSync(directory, { recursive: true });
  const layerFile = {
    L1: 'metadata.json',
    L2: 'geometry.json',
    L3: 'styles.json',
    L4: 'dom-aria.json',
    L5: 'interaction.json',
    L6: 'responsive.json',
  }[record.layer];
  const sharedEntries = Array.isArray(shared) ? shared : [shared];
  const selected = sharedEntries.flatMap((entry) => [
    entry.files[layerFile],
    entry.files['metadata.json'],
    entry.files['page.png'],
  ]).filter(Boolean);
  selected.push(referenceManifestPath);
  const files = selected.map((filePath) => ({
    path: path.relative(ROOT, filePath).split(path.sep).join('/'),
    sha256: sha256File(filePath),
  }));
  const metadata = {
    schema: 'workbuddy-v021/gap-evidence/v1',
    gap_id: record.gap_id,
    commit: record.commit,
    captured_at: record.captured_at,
    environment,
    collection_status: sharedEntries.map((entry) => entry.status ?? 'recorded'),
    role_coverage: sharedEntries.map((entry) => ({
      role: entry.role ?? 'guest',
      variant: entry.variant ?? 'default',
      status: entry.status ?? 'recorded',
      metadata: path.relative(ROOT, entry.files['metadata.json']).split(path.sep).join('/'),
    })),
    official_pixel_reference: false,
    files,
    sha256: `sha256:${createHash('sha256').update(JSON.stringify(files)).digest('hex')}`,
  };
  const metadataPath = path.join(directory, 'metadata.json');
  writeJson(metadataPath, metadata);
  return metadataPath;
}

export function writeReferenceManifest({ commit, environment, capturedAt, baselinePath = null, officialObservationsPath = null, fileName = 'reference-manifest.json' }) {
  const manifestPath = path.join(EVIDENCE_ROOT, fileName);
  const baselineRelative = baselinePath
    ? path.relative(ROOT, baselinePath).split(path.sep).join('/')
    : 'docs/evidence/visual/v0.0.21/before/_shared';
  const references = [
    {
      reference_id: 'NONE-OFFICIAL-PIXEL-SPEC',
      kind: 'none',
      url_or_path: null,
      captured_at: capturedAt,
      legal_basis: 'No legally eligible official pixel specification is available in the repository.',
      auth_role: 'guest',
      viewport: 'all',
      dpr: 1,
      locale: 'zh-CN',
      sha256: null,
      eligible_for_official_pixel_claim: false,
    },
    {
      reference_id: 'SELF-V021-BEFORE',
      kind: 'project-owned-baseline',
      url_or_path: baselineRelative,
      captured_at: capturedAt,
      legal_basis: 'Project-owned source and screenshots; regression only.',
      auth_role: 'all',
      viewport: 'all',
      dpr: 1,
      locale: 'zh-CN',
      sha256: baselinePath
        ? sha256File(baselinePath)
        : `sha256:${createHash('sha256').update(JSON.stringify(environment)).digest('hex')}`,
      eligible_for_official_pixel_claim: false,
    },
  ];
  if (officialObservationsPath && fs.existsSync(officialObservationsPath)) {
    references.push({
      reference_id: 'OFFICIAL-LIVE-OBSERVATIONS',
      kind: 'public-interaction-contract',
      url_or_path: path.relative(ROOT, officialObservationsPath).split(path.sep).join('/'),
      captured_at: capturedAt,
      legal_basis: 'Public official pages observed live; numeric geometry and computed style only; no source or assets copied.',
      auth_role: 'guest',
      viewport: 'observed',
      dpr: 1,
      locale: 'zh-CN',
      sha256: sha256File(officialObservationsPath),
      eligible_for_official_pixel_claim: false,
    });
  }
  const manifest = {
    schema: 'workbuddy-v021/reference-manifest/v1',
    generated_at: capturedAt,
    commit,
    environment,
    references,
  };
  writeJson(manifestPath, manifest);
  return manifestPath;
}

export { EVIDENCE_ROOT };
