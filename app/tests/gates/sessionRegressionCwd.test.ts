// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// `scripts/lint-session-regression.ts` 的**路径基准**回归：
// 该门禁内部用「仓库相对路径」（`app/src/...`）定位文件。旧实现把基准取成 `cwd`
// ⇒ 从 `app/` 运行时解析成 `app/app/src/...`，报出误导性的「文件不存在」。
// 现改为从**脚本自身位置**推导仓库根，本文件钉住"与 cwd 无关"。
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/lint-session-regression.ts');

function run(
  cwd: string,
  env: Record<string, string> = {}
): { code: number | null; out: string } {
  const base = { ...process.env };
  delete base['PYAPP_PROJECT_DIR'];
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd,
    env: { ...base, ...env },
    encoding: 'utf-8',
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('lint:session 路径基准与 cwd 无关', () => {
  it('仓库根运行 ⇒ 通过', () => {
    const r = run(REPO_ROOT);
    expect(r.code).toBe(0);
    expect(r.out).toContain('0 违规');
  });

  it('从 app/ 运行 ⇒ 仍通过（旧实现会误报「文件不存在」）', () => {
    const r = run(resolve(REPO_ROOT, 'app'));
    expect(r.out).not.toContain('文件不存在');
    expect(r.code).toBe(0);
  });

  it('PYAPP_PROJECT_DIR 覆盖仍生效（app/ + .. ⇒ 仓库根）', () => {
    const r = run(resolve(REPO_ROOT, 'app'), { PYAPP_PROJECT_DIR: '..' });
    expect(r.code).toBe(0);
  });
});
