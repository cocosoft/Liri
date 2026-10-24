/**
 * `lint:workflows` 门禁自证（2026-10-24）。
 *
 * 背景：workflow YAML 写坏时 **GitHub 只留一条 0 job 的失败记录**（名字是文件路径），
 * 本地 typecheck / eslint 都不解析 workflow ⇒ 必须有一条能在提交前红的门禁。
 * 本文件用临时夹具证明它**不是恒绿断言**：
 *   ① 合法 workflow ⇒ 0；② 未加引号的 `: ` ⇒ 1；③ 缺 `jobs` ⇒ 1；④ 根不存在 ⇒ 1（fail-closed）。
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(APP_DIR, 'scripts/lint-workflows.ts');

const fixtures: string[] = [];
const tmp = mkdtempSync(join(tmpdir(), 'wf-gate-'));
fixtures.push(tmp);

/** 建一个 `--root` 夹具：<tmp>/<case>/.github/workflows/<name>.yml */
function fixture(caseName: string, yml: string): string {
  const root = join(tmp, caseName);
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, '.github/workflows/ci.yml'), yml);
  return root;
}

function run(root: string): { code: number; out: string } {
  const result = spawnSync('bun', [SCRIPT, '--root', root], {
    encoding: 'utf-8',
  });
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

describe('GitHub Actions YAML 门禁（lint:workflows）', () => {
  test('合法 workflow ⇒ 退出 0 并报出文件数', () => {
    const root = fixture(
      'ok',
      [
        'name: CI',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
      ].join('\n')
    );
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out).toContain('✅');
  });

  test('未加引号的 `name: x (a: b)` ⇒ 红（本次实证的真实写法）', () => {
    const root = fixture(
      'bad-colon',
      [
        'name: CI',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Package build (tsc: barrel + per-module output)',
        '        run: echo ok',
      ].join('\n')
    );
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('.github/workflows/ci.yml');
  });

  test('缺少 jobs 段 ⇒ 红（GitHub 会判无效）', () => {
    const root = fixture('no-jobs', ['name: CI', 'on: push'].join('\n'));
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toContain('jobs');
  });

  test('扫描根不存在 ⇒ 红（fail-closed，不视为通过）', () => {
    const { code, out } = run(join(tmp, 'nope'));
    expect(code).toBe(1);
    expect(out).toContain('fail-closed');
  });
});
