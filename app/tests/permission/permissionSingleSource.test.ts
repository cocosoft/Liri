/**
 * `lint:permission-single-source` 自证（P2-2 / P2-3，2026-11-03）。
 *
 * 立论同 `gateParity.test.ts`：门禁"跑绿了"不等于"真的会报"。
 * 本文件钉死三件事：
 *   ① 真实仓库：单一来源（exit 0）；
 *   ② 负向对照：非规范文件再写一份危险表 / 只读目录 / 废弃常量 ⇒ exit 1 并点名；
 *   ③ 解析失败（扫描目录缺失）⇒ exit 1，不得静默当作通过。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'lint-permission-single-source.ts');

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) {
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

/** 造一棵最小工程树：`app/src/dup.ts` + `packages/<placeholder>.ts` */
function fixture(dupSource: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-permission-single-source-'));
  temps.push(dir);
  mkdirSync(join(dir, 'app', 'src'), { recursive: true });
  mkdirSync(join(dir, 'packages', 'infra', 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'packages', 'infra', 'src', 'index.ts'),
    'export {};\n'
  );
  writeFileSync(join(dir, 'app', 'src', 'dup.ts'), dupSource);
  return dir;
}

function run(projectDir?: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...(projectDir ? { PYAPP_PROJECT_DIR: projectDir } : {}),
    },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('lint:permission-single-source', () => {
  it('真实仓库：危险表 / 只读目录各仅一份', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out).toContain('各仅一份');
  });

  it('负向对照：第二份只读命令目录 ⇒ exit 1 并点名', () => {
    const dir = fixture(`
export const READ_ONLY_BASES = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc']);
`);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('app/src/dup.ts');
    expect(r.out).toContain('已废弃常量');
  });

  it('负向对照：第二份危险命令表 ⇒ exit 1 并点名', () => {
    const dir = fixture(`
const danger = new Set(['rm -rf', 'mkfs', 'dd if=', 'chmod 777']);
`);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('疑似第二份危险命令表');
  });

  it('引用式别名不算第二份（exit 0）', () => {
    const dir = fixture(`
import { READ_ONLY_BASE_COMMANDS } from '@openliri/infra/security';
const READ_ONLY_BASES = READ_ONLY_BASE_COMMANDS;
`);
    const r = run(dir);
    expect(r.status).toBe(0);
  });

  it('扫描目录缺失 ⇒ exit 1（不得静默通过）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-permission-single-source-'));
    temps.push(dir);
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('扫描目录缺失');
  });
});
