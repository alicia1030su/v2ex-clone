import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MATRIX = path.join(ROOT, 'docs', 'evidence', 'visual', 'v0.0.21', 'fidelity-matrix.json');

describe('v0.0.21 visual fidelity matrix', () => {
  it('contains exactly 540 unique and validated records', () => {
    const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8')) as Array<Record<string, unknown>>;
    expect(matrix).toHaveLength(540);
    expect(new Set(matrix.map((record) => record.gap_id)).size).toBe(540);
    const output = execFileSync(process.execPath, [
      path.join(ROOT, 'tools', 'visual', 'v021', 'validate-matrix.mjs'),
      MATRIX,
    ], { encoding: 'utf8' });
    expect(JSON.parse(output)).toMatchObject({ ok: true, count: 540 });
  });

  it('keeps every P0 UNVERIFIED record blocked', () => {
    const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8')) as Array<Record<string, unknown>>;
    const blocking = matrix.filter((record) =>
      record.severity === 'P0' && record.status === 'UNVERIFIED');
    expect(blocking.length).toBeGreaterThan(0);
    for (const record of blocking) {
      expect(record.p0_blocking).toBe(true);
      expect(record.closure_allowed).toBe(false);
    }
  });

  it('ships a human matrix with 540 index rows and no visual percentage claim', () => {
    const markdown = fs.readFileSync(path.join(ROOT, 'docs', 'VISUAL_FIDELITY_MATRIX_v0.0.21.md'), 'utf8');
    expect(markdown.match(/^\| V21-P/gm)).toHaveLength(540);
    expect(markdown).not.toMatch(/\b(?:还原度|相似度)\s*[:：]?\s*\d+(?:\.\d+)?\s*%/i);
  });
});
