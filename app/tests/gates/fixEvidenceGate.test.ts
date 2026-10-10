/**
 * P1-4 —— **修复证据登记门禁自证（负向对照）**。
 *
 * 证明 `scripts/lint-fix-evidence.ts` 能发现"状态与证据不一致"，尤其：
 * 「只改代码无测试却标已验收」「跳过单元直称端到端」「声明修复却无 code 证据」。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), '..', 'scripts', 'lint-fix-evidence.ts');

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

const STAGES = (o: Partial<Record<string, boolean>> = {}) => ({
  discovered: true,
  fixed: true,
  testVerified: true,
  postReleaseReviewed: false,
  ...o,
});
const FLAGS = (o: Partial<Record<string, boolean>> = {}) => ({
  designed: true,
  coded: true,
  unitTested: true,
  e2eVerified: false,
  ...o,
});

function item(o: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'X-1',
    title: 't',
    source: 's',
    stages: STAGES(),
    flags: FLAGS(),
    code: ['src/impl.ts'],
    tests: ['tests/impl.test.ts'],
    changelog: [],
    reopenWhen: 'w',
    ...o,
  };
}

function makeFixture(items: unknown[]): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'liri-fix-gate-'));
  roots.push(root);
  mkdirSync(join(root, '.trae/architecture'), { recursive: true });
  mkdirSync(join(root, 'dev_docs/error_repairs'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'src/impl.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'tests/impl.test.ts'), '// t\n');
  writeFileSync(
    join(root, 'dev_docs/error_repairs/修复证据登记.md'),
    '# 修复证据登记\n'
  );
  const registryPath = join(
    root,
    'dev_docs/error_repairs/fix-evidence-registry.json'
  );
  writeFileSync(
    registryPath,
    JSON.stringify(
      {
        version: 1,
        stages: ['discovered', 'fixed', 'testVerified', 'postReleaseReviewed'],
        flags: ['designed', 'coded', 'unitTested', 'e2eVerified'],
        items,
      },
      null,
      2
    )
  );
  return {
    ...process.env,
    FIX_EVIDENCE_REPO_ROOT: root,
    FIX_EVIDENCE_REGISTRY: registryPath,
  };
}

function run(env: NodeJS.ProcessEnv): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('P1-4 修复证据门禁 · 负向自证', () => {
  it('合规条目 ⇒ 通过（exit 0）', () => {
    const r = run(makeFixture([item({})]));
    expect(r.status).toBe(0);
    expect(r.out).toContain('✅');
  });

  it('unitTested=true 但无 tests ⇒ 变红（"只改代码无测试不得称已验收"）', () => {
    const r = run(makeFixture([item({ tests: [] })]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('无 tests 证据');
  });

  it('e2eVerified=true 但 unitTested=false ⇒ 变红（不得跳过单元直称端到端）', () => {
    const r = run(
      makeFixture([
        item({ flags: FLAGS({ unitTested: false, e2eVerified: true }) }),
      ])
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain('不得跳过单元直称端到端');
  });

  it('fixed=true 但无 code 证据 ⇒ 变红', () => {
    const r = run(makeFixture([item({ code: [] })]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('无 code 证据');
  });

  it('证据路径不存在 ⇒ 变红', () => {
    const r = run(makeFixture([item({ code: ['src/missing.ts'] })]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('证据路径不存在');
  });

  it('postReleaseReviewed=true 但无 changelog ⇒ 变红', () => {
    const r = run(
      makeFixture([item({ stages: STAGES({ postReleaseReviewed: true }) })])
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain('无 changelog 记录');
  });

  it('id 重复 ⇒ 变红', () => {
    const r = run(makeFixture([item({}), item({})]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('id 重复');
  });
});
