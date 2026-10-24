/**
 * 文档别名门禁（`scripts/lint-doc-alias.ts`）**自证**。
 *
 * 为什么需要：门禁「绿」只说明当时没报，不说明它**会报**。2026-10-24 上线当天，
 * 它抓到的第一个活 bug 就是 `AGENTS.md` 里的 `@modules/core/paths`（别名已删，照做即编译失败）——
 * 若正则写坏、或把所有 token 都当占位符放过，它会**静默恒绿**。
 *
 * 夹具通过 `PYAPP_PROJECT_DIR` 指到临时目录（脚本的 repoRoot / 基线路径都相对它推导）。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const GATE = resolve(import.meta.dir, '../../../scripts/lint-doc-alias.ts');
const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** 夹具 tsconfig：只注册两个别名，用来区分「存在」与「已删除」 */
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    baseUrl: './src',
    paths: { '@modules/ai': ['ai'], '@modules/ai/*': ['ai/*'] },
  },
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'doc-alias-'));
  roots.push(root);
  const base = { 'app/tsconfig.json': TSCONFIG };
  for (const [rel, content] of Object.entries({ ...base, ...files })) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return root;
}

function run(root: string, ...args: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd: root,
    env: { ...process.env, PYAPP_PROJECT_DIR: root },
    encoding: 'utf-8',
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('文档别名门禁：违规样例必红', () => {
  it('未注册的别名 ⇒ 红，并点名文件与原因', () => {
    // 注意：夹具**不要**用 `@modules/core/...` 字面量 —— `codemod-core-imports --check`
    // 会把它当成「旧别名回流」而红（2026-10-24 实测踩中），与实际要验证的东西无关。
    const root = fixture({
      '.trae/rules/probe.md': '用 `@modules/ghostRouter` 取路由\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('probe.md:1');
    expect(out).toContain('@modules/ghostRouter');
    expect(out).toContain('tsconfig paths 里没有');
  });

  it('内核子路径不在公开清单 ⇒ 红（走的是 KERNEL_PUBLIC_SUBPATHS 口径）', () => {
    const root = fixture({
      '.trae/rules/probe.md': '`@openliri/kernel/DIContainer`\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('不在公开清单');
  });
});

describe('文档别名门禁：合法/占位样例必绿（防误伤）', () => {
  it('已注册别名、桶入口、公开子路径 ⇒ 绿', () => {
    const root = fixture({
      '.trae/rules/ok.md':
        '`@modules/ai/router` 与 `@openliri/kernel` 与 `@openliri/kernel/paths`\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(0);
    expect(out).toContain('全部可解析');
  });

  it('泛指命名空间与占位符不算违规', () => {
    const root = fixture({
      '.trae/rules/placeholders.md':
        '除 `@modules/` 之外；示例 `@modules/<模块>` / `@modules/xxx`\n',
    });

    expect(run(root).code).toBe(0);
  });

  it('扫描面含 app/docs（随产品发布的文档）', () => {
    const root = fixture({
      'app/docs/guide.md': '用 `@modules/ghostRouter`\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('app/docs/guide.md');
  });

  it('教程示例模块名（`@modules/my-module`）不算违规', () => {
    const root = fixture({
      'app/docs/tutorial.md': '保留原有导入路径（`@modules/my-module`）\n',
    });

    expect(run(root).code).toBe(0);
  });

  it('扫描面之外的文件（如 dev_docs 之外的普通 md）不被误判', () => {
    const root = fixture({
      'notes.md': '`@modules/ghost`\n',
    });

    expect(run(root).code).toBe(0);
  });
});

describe('文档引用门禁：文件路径', () => {
  it('内联代码里的路径不存在 ⇒ 红', () => {
    const root = fixture({
      '.trae/rules/probe.md': '见 `app/src/ghost-file.ts`\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('app/src/ghost-file.ts');
    expect(out).toContain('文件不存在');
  });

  it('围栏代码块（示例）与历史措辞行 ⇒ 不判违规', () => {
    const root = fixture({
      '.trae/rules/examples.md':
        '```ts\nimport x from `app/src/ghost-a.ts`\n```\n原为 `app/src/ghost-b.ts`，已迁移\n',
      'app/src/real.ts': 'export const ok = 1;\n',
      '.trae/rules/real.md': '见 `app/src/real.ts`\n',
    });

    expect(run(root).code).toBe(0);
  });
});

describe('文档别名门禁：基线棘轮', () => {
  const LEAK = { '.trae/rules/legacy.md': '`@modules/ghost`\n' };

  it('已登记 ⇒ 绿；--write-baseline 只能下调 maxEntries', () => {
    const root = fixture(LEAK);
    expect(run(root).code).toBe(1);

    expect(run(root, '--write-baseline').code).toBe(0);
    const written = JSON.parse(
      readFileSync(
        join(root, '.trae/architecture/doc-alias-baseline.json'),
        'utf-8'
      )
    ) as { maxEntries: number; entries: unknown[] };
    expect(written.entries.length).toBe(1);
    expect(written.maxEntries).toBe(1);
    expect(run(root).code).toBe(0);
  });

  it('条目数 > maxEntries ⇒ 红（想放宽必须手改 json）', () => {
    const root = fixture({
      ...LEAK,
      '.trae/architecture/doc-alias-baseline.json': JSON.stringify({
        version: 1,
        maxEntries: 0,
        entries: [{ file: '.trae/rules/legacy.md', alias: '@modules/ghost' }],
      }),
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('maxEntries');
  });
});
