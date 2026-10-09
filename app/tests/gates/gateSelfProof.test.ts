// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 门禁**自证**（R5，第九轮审查 §3.4）—— 「违规控制样例」成对回归。
 *
 * **为什么需要**：绿色 CI 只说明"当时没报"，**不说明门禁真的会报**（门禁自身可能因
 * 解析失败/路径漂移/规则被误排除而**静默返回 0 违规**；历史实证详见
 * `lint-architecture.ts` 的 AR-2 注记：R05-007 曾因 `existsSync` 判否**静默 return**）。
 * 本文件用**临时夹具工程**跑真实脚本，断言：
 * ① **违规样例必失败**（非零退出）· ② **合法样例必通过**（退出 0）· ③ **定位/解析错误必非零退出**
 * （而非"找不到就当作 0 违规"）。
 *
 * 夹具只含 `app/src/...`（分层映射仍由脚本自带的 `scripts/modules-to-layers.json` 提供，
 * 与夹具无关）；通过 `PYAPP_PROJECT_DIR='.'` + `cwd=夹具根` 让脚本按夹具解析。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptsDir = resolve(import.meta.dir, '../../../scripts');

/** 以夹具根为项目根运行门禁脚本；返回退出码与合并输出 */
function runGate(scriptFile: string, fixtureRoot: string) {
  const r = spawnSync(process.execPath, ['run', join(scriptsDir, scriptFile)], {
    cwd: fixtureRoot,
    env: { ...process.env, PYAPP_PROJECT_DIR: '.' },
    encoding: 'utf-8',
    timeout: 120_000,
  });
  return {
    code: r.status ?? -1,
    output: `${r.stdout ?? ''}\n${r.stderr ?? ''}`,
  };
}

let baseDir = '';
/** 合法夹具：`core` 内自依赖（同层） */
let legalDir = '';
/** 违规夹具：`core` → `infra`（`utils`）跨层引用 */
let illegalDir = '';
/** 无 `app/src` ⇒ 定位错误 */
let noSrcDir = '';
/** 巨型文件夹具（>2000 行） */
let bigDir = '';
/** 合法（小文件）夹具 */
let smallDir = '';

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'gate-selfproof-'));

  legalDir = join(baseDir, 'legal');
  mkdirSync(join(legalDir, 'app', 'src', 'core'), { recursive: true });
  writeFileSync(
    join(legalDir, 'app', 'src', 'core', 'probe.ts'),
    'export const ok = 1;\n'
  );

  illegalDir = join(baseDir, 'illegal');
  mkdirSync(join(illegalDir, 'app', 'src', 'core'), { recursive: true });
  mkdirSync(join(illegalDir, 'app', 'src', 'utils'), { recursive: true });
  writeFileSync(
    join(illegalDir, 'app', 'src', 'utils', 'thing.ts'),
    'export const t = 1;\n'
  );
  // core(层 core) → utils(层 infra)：`core` 的 allowedDependencies 仅 `["core"]`
  writeFileSync(
    join(illegalDir, 'app', 'src', 'core', 'probe.ts'),
    "import { t } from '@modules/utils/thing';\nexport const x = t;\n"
  );

  noSrcDir = join(baseDir, 'nosrc');
  mkdirSync(noSrcDir, { recursive: true });

  bigDir = join(baseDir, 'big');
  mkdirSync(join(bigDir, 'app', 'src', 'x'), { recursive: true });
  writeFileSync(
    join(bigDir, 'app', 'src', 'x', 'big.ts'),
    Array.from({ length: 2100 }, (_, i) => `export const v${i} = ${i};`).join(
      '\n'
    ) + '\n'
  );

  smallDir = join(baseDir, 'small');
  mkdirSync(join(smallDir, 'app', 'src', 'x'), { recursive: true });
  writeFileSync(
    join(smallDir, 'app', 'src', 'x', 'small.ts'),
    'export const v = 1;\n'
  );
});

afterAll(() => {
  if (baseDir && existsSync(baseDir)) {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

describe('R5 门禁自证：lint:arch', () => {
  it('【合法样例】同层自依赖 ⇒ 通过（退出 0）', () => {
    const r = runGate('lint-architecture.ts', legalDir);
    expect(r.output).toContain('架构合规检查结果');
    expect(r.code).toBe(0);
  });

  it('【违规样例】core → infra 跨层引用 ⇒ **必失败**（退出 1 且报 R00-001）', () => {
    const r = runGate('lint-architecture.ts', illegalDir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R00-001');
  });

  it('【定位错误】无 app/src ⇒ **非零退出**（不得当作"0 违规"通过）', () => {
    const r = runGate('lint-architecture.ts', noSrcDir);
    expect(r.code).toBe(2);
    expect(r.output).toContain('找不到 src 目录');
  });
});

describe('R5 门禁自证：lint:size', () => {
  it('【违规样例】>2000 行 ⇒ **必失败**（退出 1）', () => {
    const r = runGate('lint-file-size.ts', bigDir);
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/\[ERROR\]/);
  });

  it('【合法样例】小文件 ⇒ 通过（退出 0）', () => {
    const r = runGate('lint-file-size.ts', smallDir);
    expect(r.code).toBe(0);
  });
});
