import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PAGE_CLASS_SPECS, VIEWPORTS, LAYERS } from './spec.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_MATRIX = path.join(ROOT, 'docs', 'evidence', 'visual', 'v0.0.21', 'fidelity-matrix.json');
const REQUIRED_FIELDS = [
  'gap_id', 'page_class', 'route', 'auth_role', 'viewport', 'layer',
  'reference_id', 'reference_url_or_path', 'captured_at', 'legal_basis',
  'baseline_selector', 'baseline_value', 'current_selector', 'current_value',
  'delta', 'classification', 'severity', 'status', 'evidence_before',
  'evidence_after', 'owner', 'commit', 'retest_result', 'notes',
  'states', 'probe_results', 'p0_blocking', 'closure_allowed',
];

function isMain() {
  return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}

/**
 * Validate matrix completeness, terminal states, evidence metadata, and P0
 * closure rules. Throws on the first actionable violation.
 *
 * @param {string} matrixPath
 * @param {{requireEvidence?:boolean}} [options]
 * @returns {{count:number, statuses:object, p0Blocking:number}}
 */
export async function validateMatrix(matrixPath = DEFAULT_MATRIX, options = {}) {
  const records = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const manifestPath = path.join(path.dirname(matrixPath), 'reference-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const referenceIds = new Set(manifest.references.map((reference) => reference.reference_id));
  for (const reference of manifest.references) {
    if (reference.sha256 && reference.url_or_path) {
      const referencePath = path.resolve(ROOT, reference.url_or_path);
      if (fs.existsSync(referencePath) && fs.statSync(referencePath).isFile()) {
        const digest = `sha256:${(await import('node:crypto')).createHash('sha256').update(fs.readFileSync(referencePath)).digest('hex')}`;
        if (digest !== reference.sha256) throw new Error(`reference hash mismatch ${reference.reference_id}`);
      }
    }
  }
  if (!Array.isArray(records) || records.length !== 540) {
    throw new Error(`matrix must contain exactly 540 records, found ${Array.isArray(records) ? records.length : 'non-array'}`);
  }
  const ids = new Set();
  const combinations = new Set();
  const statuses = { VERIFIED: 0, INTENTIONAL_DIFFERENCE: 0, UNVERIFIED: 0 };
  let p0Blocking = 0;

  for (const record of records) {
    for (const field of REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) {
        throw new Error(`${record.gap_id ?? 'unknown'} missing field ${field}`);
      }
    }
    if (ids.has(record.gap_id)) throw new Error(`duplicate gap_id ${record.gap_id}`);
    ids.add(record.gap_id);
    const combination = `${record.page_class}|${record.viewport}|${record.layer}`;
    if (combinations.has(combination)) throw new Error(`duplicate combination ${combination}`);
    combinations.add(combination);
    if (!referenceIds.has(record.reference_id)) {
      throw new Error(`${record.gap_id} references unknown manifest entry ${record.reference_id}`);
    }
    const reference = manifest.references.find((entry) => entry.reference_id === record.reference_id);
    if (reference?.eligible_for_official_pixel_claim === false && record.status === 'VERIFIED') {
      throw new Error(`${record.gap_id} cannot be VERIFIED against a non-official reference`);
    }
    if (!['VERIFIED', 'INTENTIONAL_DIFFERENCE', 'UNVERIFIED'].includes(record.status)) {
      throw new Error(`${record.gap_id} has invalid terminal state ${record.status}`);
    }
    statuses[record.status] += 1;
    if (!['A', 'B', 'C', 'D', 'E'].includes(record.classification)) {
      throw new Error(`${record.gap_id} has invalid classification`);
    }
    if (!Array.isArray(record.states) || record.states.length === 0) {
      throw new Error(`${record.gap_id} has no states`);
    }
    if (!Array.isArray(record.probe_results) || record.probe_results.length === 0) {
      throw new Error(`${record.gap_id} has no probes`);
    }
    if (record.severity === 'P0' && record.status === 'UNVERIFIED') {
      p0Blocking += 1;
      if (record.p0_blocking !== true || record.closure_allowed !== false) {
        throw new Error(`${record.gap_id} P0 UNVERIFIED must block closure`);
      }
    }

    if (options.requireEvidence !== false) {
      const evidencePath = path.resolve(ROOT, record.evidence_before);
      if (!fs.existsSync(evidencePath)) throw new Error(`${record.gap_id} missing before evidence ${record.evidence_before}`);
      const metadata = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      if (metadata.gap_id !== record.gap_id) throw new Error(`${record.gap_id} evidence gap_id mismatch`);
      if (metadata.commit !== record.commit) throw new Error(`${record.gap_id} evidence commit mismatch`);
      if (!metadata.environment || !metadata.sha256 || !Array.isArray(metadata.files)) {
        throw new Error(`${record.gap_id} evidence metadata is incomplete`);
      }
      const collectionStates = Array.isArray(metadata.collection_status)
        ? metadata.collection_status
        : [metadata.collection_status];
      if (collectionStates.some((status) => status === 'collection-error' || status === 'error')) {
        throw new Error(`${record.gap_id} evidence collection failed: ${collectionStates.join(',')}`);
      }
      for (const file of metadata.files) {
        const filePath = path.resolve(ROOT, file.path);
        if (!fs.existsSync(filePath)) throw new Error(`${record.gap_id} evidence file missing ${file.path}`);
        const digest = `sha256:${(await import('node:crypto')).createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
        if (digest !== file.sha256) throw new Error(`${record.gap_id} evidence hash mismatch ${file.path}`);
      }
    }
  }

  const expected = new Set();
  for (const pageClass of PAGE_CLASS_SPECS) {
    for (const viewport of VIEWPORTS) {
      for (const layer of LAYERS) {
        expected.add(`${pageClass.slug}|${viewport.name}|${layer.id}`);
      }
    }
  }
  for (const combination of expected) {
    if (!combinations.has(combination)) throw new Error(`missing combination ${combination}`);
  }
  return { count: records.length, statuses, p0Blocking };
}

if (isMain()) {
  const matrixPath = process.argv[2] ?? DEFAULT_MATRIX;
  validateMatrix(matrixPath).then((result) => {
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
