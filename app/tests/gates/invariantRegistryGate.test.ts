/**
 * P1-2 —— **门禁自证（负向对照）**：不变量注册表门禁必须能**发现**违规。
 *
 * 原理：`scripts/lint-invariants.ts` 支持路径环境变量覆盖（`INVARIANTS_REPO_ROOT` /
 * `INVARIANT_REGISTRY` / `INVARIANTS_DOC`）⇒ 本测试在**临时目录**构造最小"仓库"，
 * 分别喂入**合规**与**违规**样例，断言门禁**通过 / 变红**。
 *
 * 这直接回应外部审查「门禁不应只证明当前代码通过，还应证明有人重新引入缺陷时检查一定能发现」。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), '..', 'scripts', 'lint-invariants.ts');

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

/** 构造最小"仓库"：返回各路径与 env */
function makeFixture(opts: { registry: unknown; doc: string }): {
  root: string;
  env: NodeJS.ProcessEnv;
} {
  const root = mkdtempSync(join(tmpdir(), 'liri-inv-gate-'));
  roots.push(root);
  mkdirSync(join(root, '.trae/architecture'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  mkdirSync(join(root, 'specs'), { recursive: true });

  // 落点文件（合规样例引用它们）
  writeFileSync(join(root, 'src/impl.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'tests/impl.test.ts'), '// test\n');
  writeFileSync(join(root, 'specs/foo.md'), '# spec\n');
  writeFileSync(
    join(root, '.trae/architecture/invariant-registry.json'),
    JSON.stringify(opts.registry, null, 2)
  );
  const docPath = join(root, '.trae/architecture/invariants.md');
  writeFileSync(docPath, opts.doc);

  return {
    root,
    env: {
      ...process.env,
      INVARIANTS_REPO_ROOT: root,
      INVARIANT_REGISTRY: join(
        root,
        '.trae/architecture/invariant-registry.json'
      ),
      INVARIANTS_DOC: docPath,
    },
  };
}

const DOC_OK = [
  '## §0 原则',
  '## §1 级别',
  '## §2 清单',
  '## §3 缺口',
  '## §4 索引',
  '## §5 变更',
  '[registry](./invariant-registry.json)',
  'INV-T-002',
].join('\n');

const REG_OK = {
  version: 1,
  levels: ['unit', 'static'],
  invariants: [
    {
      id: 'INV-T-001',
      title: 't1',
      statement: 's1',
      sources: ['src/impl.ts'],
      tests: ['tests/impl.test.ts'],
      level: 'unit',
      status: 'verified',
      reopenWhen: 'x',
      specs: ['specs/foo.md'],
    },
    {
      id: 'INV-T-002',
      title: 't2',
      statement: 's2',
      sources: ['src/impl.ts'],
      tests: [],
      level: 'static',
      status: 'gap',
      reopenWhen: 'y',
      specs: [],
    },
  ],
};

function run(env: NodeJS.ProcessEnv): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('P1-2 不变量门禁 · 负向自证', () => {
  it('合规样例 ⇒ 通过（exit 0）', () => {
    const { env } = makeFixture({ registry: REG_OK, doc: DOC_OK });
    const r = run(env);
    expect(r.status).toBe(0);
    expect(r.out).toContain('✅');
  });

  it('源码落点不存在 ⇒ 变红（exit 1）', () => {
    const broken = structuredClone(REG_OK);
    broken.invariants[0].sources = ['src/does-not-exist.ts'];
    const { env } = makeFixture({ registry: broken, doc: DOC_OK });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('源码落点不存在');
  });

  it('验证落点不存在 ⇒ 变红（exit 1）', () => {
    const broken = structuredClone(REG_OK);
    broken.invariants[0].tests = ['tests/missing.test.ts'];
    const { env } = makeFixture({ registry: broken, doc: DOC_OK });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('验证落点不存在');
  });

  it('关联 spec 不存在 ⇒ 变红（exit 1）', () => {
    const broken = structuredClone(REG_OK);
    broken.invariants[0].specs = ['specs/missing.md'];
    const { env } = makeFixture({ registry: broken, doc: DOC_OK });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('关联 spec 不存在');
  });

  it('缺失必备章节 ⇒ 变红（exit 1）', () => {
    const docMissing = DOC_OK.replace('## §5 变更', '## 变更（标题不合规）');
    const { env } = makeFixture({ registry: REG_OK, doc: docMissing });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('缺少必备章节');
  });

  it('文档断链 ⇒ 变红（exit 1）', () => {
    const docBroken = `${DOC_OK}\n[dead](./nope.md)\n`;
    const { env } = makeFixture({ registry: REG_OK, doc: docBroken });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('断链');
  });

  it('gap 项未在文档登记 ⇒ 变红（exit 1）', () => {
    const docNoGap = DOC_OK.replace('INV-T-002', '');
    const { env } = makeFixture({ registry: REG_OK, doc: docNoGap });
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('未在 invariants.md 登记');
  });
});
