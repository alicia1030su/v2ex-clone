import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** v0.0.18 P1-2：路由枚举必须来自真实源码，而不是旧文档快照。 */
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/audit/route-inventory.mjs');
type Inventory = {
  counts: { pages: number; apis: number; apiMethods: number };
  pages: Array<{ route: string; source: string; hint: string; pageInventory: boolean }>;
  apis: Array<{ route: string; source: string; methods: string[]; hint: string; permission: string | null; apiSpec: boolean }>;
};
type AuditModule = {
  enumerateRoutes(root?: string): Inventory;
  routeFromFile(root: string, file: string): { route: string; source: string };
  toMarkdown(inventory: Inventory): string;
};
async function loadAudit(): Promise<AuditModule> {
  return await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href) as AuditModule;
}

describe('v0.0.18 当前源码路由清单', () => {
  it('真实枚举：页面/API 数量与数组一致，动态路由和方法不丢失', async () => {
    const audit = await loadAudit();
    const inventory = audit.enumerateRoutes(ROOT);
    expect(inventory.counts.pages).toBe(inventory.pages.length);
    expect(inventory.counts.apis).toBe(inventory.apis.length);
    expect(inventory.counts.apiMethods).toBe(inventory.apis.reduce((sum, api) => sum + api.methods.length, 0));
    expect(inventory.pages.length).toBeGreaterThan(20);
    expect(inventory.apis.length).toBeGreaterThan(60);
    expect(inventory.pages.map((page) => page.route)).toEqual(expect.arrayContaining([
      '/', '/member/:username', '/t/:id', '/go/:name', '/settings', '/admin',
    ]));
    const votes = inventory.apis.find((api) => api.route === '/api/votes');
    expect(votes?.methods).toEqual(expect.arrayContaining(['POST', 'DELETE']));
    expect(votes?.hint).toBe('authenticated');
    const ops = inventory.apis.find((api) => api.route === '/api/admin/ops');
    expect(ops?.hint).toBe('admin');
    expect(ops?.permission).toBe('ops.view');
  });

  it('合成目录：route group 与私有目录不进入 URL，catch-all 正确转换', async () => {
    const audit = await loadAudit();
    const root = mkdtempSync(path.join(tmpdir(), 'v018-routes-'));
    try {
      const files: Record<string, string> = {
        'docs/PAGE_INVENTORY.md': '# inventory\n',
        'docs/API_SPEC.md': '# api\n',
        'src/app/(marketing)/page.tsx': 'export default function Page() { return null; }',
        'src/app/blog/[slug]/page.tsx': 'export default function Page() { return null; }',
        'src/app/api/items/[...id]/route.ts': "import { adminGuard } from '@/lib/admin-guard';\nexport async function GET() { await adminGuard(null, 'items.view'); }\nexport const POST = async () => { await adminGuard(null, 'items.write'); };",
        'src/app/_private/page.tsx': 'export default function Page() { return null; }',
      };
      for (const [relative, content] of Object.entries(files)) {
        const file = path.join(root, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      const inventory = audit.enumerateRoutes(root);
      expect(inventory.pages.map((page) => page.route).sort()).toEqual(['/', '/blog/:slug']);
      expect(inventory.apis).toHaveLength(1);
      expect(inventory.apis[0].route).toBe('/api/items/*id');
      expect(inventory.apis[0].methods).toEqual(['GET', 'POST']);
      expect(inventory.apis[0].hint).toBe('admin');
      const markdown = audit.toMarkdown(inventory);
      expect(markdown).toContain('`/blog/:slug`');
      expect(markdown).toContain('`/api/items/*id`');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('未知 CLI 参数必须非零退出', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--bogus'], { cwd: ROOT, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('未知或无效参数');
  });
});
