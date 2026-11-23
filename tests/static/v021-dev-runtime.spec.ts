import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('v0.0.21 development runtime', () => {
  it('keeps sharp external so Next dev does not bundle its child_process dependency', () => {
    const config = fs.readFileSync(path.join(ROOT, 'next.config.mjs'), 'utf8');
    expect(config).toMatch(/serverExternalPackages:\s*\[[^\]]*['"]sharp['"][^\]]*\]/);
  });

  it('keeps the instrumentation purge worker independent of sharp-backed modules', () => {
    const purge = fs.readFileSync(path.join(ROOT, 'src', 'server', 'attachment-purge.ts'), 'utf8');
    expect(purge).toContain("from '@/lib/avatar-storage'");
    expect(purge).toContain("from '@/lib/reply-image-storage'");
    expect(purge).not.toContain("from '@/lib/avatar'");
    expect(purge).not.toContain("from '@/lib/reply-images'");
  });

  it('starts background workers from the Node layout bundle, not instrumentation', () => {
    const instrumentation = fs.readFileSync(path.join(ROOT, 'src', 'instrumentation.ts'), 'utf8');
    const layout = fs.readFileSync(path.join(ROOT, 'src', 'app', 'layout.tsx'), 'utf8');
    expect(instrumentation).not.toContain("from '@/server/attachment-purge'");
    expect(instrumentation).not.toContain("import('@/server/attachment-purge')");
    expect(instrumentation).toContain("process.getBuiltinModule('http')");
    expect(instrumentation).not.toContain("import('node:http')");
    expect(instrumentation).not.toMatch(/await import\(['"](?:node:)?http['"]\)/);
    expect(layout).toContain('ensureAttachmentPurgeWorker');
  });

  it('uses direct Node entrypoints for low-memory Next scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:low']).toContain('node node_modules/next/dist/bin/next dev');
    expect(pkg.scripts['build:low']).toContain('node node_modules/next/dist/bin/next build');
  });
});
