/**
 * P1-3 —— **执行入口注册门禁自证（负向对照）**。
 *
 * 证明 `scripts/lint-entrypoints.ts` 能发现：① 未登记的新入口；② 登记漂移（声明模式未命中）；
 * ③ 登记文件不存在。合规样例则应通过。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), '..', 'scripts', 'lint-entrypoints.ts');

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 测试清理
    }
  }
});

const PATTERNS = [
  {
    id: 'coreapi.chatstream',
    regex: 'coreAPI\\.chatStream\\(',
    description: 'x',
  },
  {
    id: 'execution.acquire',
    regex: 'executionManager\\.acquire\\(',
    description: 'y',
  },
];

function makeFixture(opts: {
  /** 相对 app/src 的源文件 → 内容 */
  sources: Record<string, string>;
  entries: Array<{ file: string; patterns: string[] }>;
}): { root: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), 'liri-entry-gate-'));
  roots.push(root);
  mkdirSync(join(root, '.trae/architecture'), { recursive: true });
  for (const [rel, content] of Object.entries(opts.sources)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  mkdirSync(join(root, 'app/src'), { recursive: true });
  const registryPath = join(
    root,
    '.trae/architecture/execution-entrypoints.json'
  );
  writeFileSync(
    registryPath,
    JSON.stringify(
      {
        version: 1,
        patterns: PATTERNS,
        entries: opts.entries.map((e) => ({
          file: e.file,
          patterns: e.patterns,
          label: 'x',
          status: 'verified',
          notes: '',
        })),
      },
      null,
      2
    )
  );
  return {
    root,
    env: {
      ...process.env,
      ENTRYPOINTS_REPO_ROOT: root,
      ENTRYPOINTS_REGISTRY: registryPath,
      ENTRYPOINTS_SCAN_ROOT: join(root, 'app/src'),
    },
  };
}

function run(env: NodeJS.ProcessEnv): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('P1-3 执行入口门禁 · 负向自证', () => {
  it('扫描与登记一致 ⇒ 通过（exit 0）', () => {
    const { env } = makeFixture({
      sources: { 'app/src/a.ts': 'coreAPI.chatStream({});\n' },
      entries: [{ file: 'app/src/a.ts', patterns: ['coreapi.chatstream'] }],
    });
    const r = run(env);
    expect(r.status).toBe(0);
    expect(r.out).toContain('✅');
  });

  it('新增入口未登记 ⇒ 变红（exit 1）', () => {
    const { env } = makeFixture({
      sources: {
        'app/src/a.ts': 'coreAPI.chatStream({});\n',
        'app/src/b.ts': 'executionManager.acquire(x);\n',
      },
      entries: [{ file: 'app/src/a.ts', patterns: ['coreapi.chatstream'] }],
    });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('未登记的执行入口');
  });

  it('登记漂移（声明模式未命中）⇒ 变红（exit 1）', () => {
    const { env } = makeFixture({
      sources: { 'app/src/a.ts': 'coreAPI.chatStream({});\n' },
      entries: [
        {
          file: 'app/src/a.ts',
          patterns: ['coreapi.chatstream', 'execution.acquire'],
        },
      ],
    });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('登记漂移');
  });

  it('登记文件不存在 ⇒ 变红（exit 1）', () => {
    const { env } = makeFixture({
      sources: { 'app/src/a.ts': 'coreAPI.chatStream({});\n' },
      entries: [
        { file: 'app/src/a.ts', patterns: ['coreapi.chatstream'] },
        { file: 'app/src/ghost.ts', patterns: ['execution.acquire'] },
      ],
    });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('入口文件不存在');
  });
});
