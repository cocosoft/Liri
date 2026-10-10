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
// P2-3：把自证从"lint 门禁"扩展到**安全链**与**执行状态机**（运行时控制样例）
import {
  EXECUTION_STATUSES,
  canTransition,
  isTerminalStatus,
} from '../../src/execution/types.js';
import {
  combineVerdicts,
  isPermissive,
  verdictFromScanStatus,
} from '../../src/security/decision.js';
import {
  isDangerousCommand,
  parseForSecurity,
} from '../../src/security/bash/BashAST.js';
import {
  sanitizeCallerEnv,
  stripSensitiveEnv,
} from '../../src/security/sensitiveEnv.js';

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

// ─────────────────────────────────────────────────────────────
// P2-3：从"lint 门禁"扩展到**执行状态机**与**安全链**的运行时自证
//
// 目的（外部 §六.2）：门禁不应只证明当前代码通过，还应证明**有人重新引入旧缺陷时能被发现**。
// 做法：对每条已知旧缺陷构造**控制样例**（缺陷若回归 ⇒ 断言必然失败）。
// ─────────────────────────────────────────────────────────────

describe('P2-3 门禁自证：执行状态机（非法转移 ⇒ 必须被拒）', () => {
  it('【控制样例】终态 → 活跃态 ⇒ **必被拒**（终态不可逆回归即被发现）', () => {
    const terminal = EXECUTION_STATUSES.filter(isTerminalStatus);
    expect(terminal.length).toBeGreaterThan(0);
    for (const from of terminal) {
      for (const to of EXECUTION_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('【控制样例】`CANCEL_REQUESTED` 不得回到 `COMPLETED`（fencing 回归即被发现）', () => {
    expect(canTransition('CANCEL_REQUESTED', 'COMPLETED')).toBe(false);
    expect(canTransition('CANCEL_REQUESTED', 'RUNNING')).toBe(false);
    // 仅这两条合法出边
    expect(canTransition('CANCEL_REQUESTED', 'CANCELLED')).toBe(true);
    expect(canTransition('CANCEL_REQUESTED', 'STALE')).toBe(true);
  });

  it('【控制样例】自环拒绝（`RUNNING → RUNNING`）', () => {
    for (const s of EXECUTION_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('【反向对照】合法转移仍被允许（防"恒拒"假绿）', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'CANCEL_REQUESTED')).toBe(true);
    expect(canTransition('RUNNING', 'COMPLETED')).toBe(true);
    expect(canTransition('WAITING_USER', 'RUNNING')).toBe(true);
  });
});

describe('P2-3 门禁自证：安全链（绕过控制样例 ⇒ 必须被捕获）', () => {
  it('【控制样例】`||` 绕过：`safe || rm -rf /` 必须被**拆成多条**（缺陷 #2 回归即被发现）', () => {
    const r = parseForSecurity('safe || rm -rf /');
    expect(r.kind).toBe('simple');
    if (r.kind === 'simple') {
      // 若回归为"整条当一条"，length 会变成 1 ⇒ 本断言失败
      expect(r.commands.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('【控制样例】大小写保留：`RM -rf /` 仍判危险（缺陷 #3 回归即被发现）', () => {
    expect(isDangerousCommand(['RM', '-rf', '/'])).toBe(true);
    expect(isDangerousCommand(['rm', '-rf', '/'])).toBe(true);
  });

  it('【反向对照】良性命令不得误判（防"恒真"假绿）', () => {
    expect(isDangerousCommand(['echo', 'hello'])).toBe(false);
    expect(isDangerousCommand(['ls', '-la'])).toBe(false);
  });

  it('【控制样例】`INDETERMINATE` 不得被折叠为放行（fail-open 回归即被发现）', () => {
    expect(isPermissive(combineVerdicts(['ALLOW', 'INDETERMINATE']))).toBe(
      false
    );
    expect(isPermissive(combineVerdicts([]))).toBe(false);
    expect(isPermissive(verdictFromScanStatus('skipped', false))).toBe(false);
    expect(isPermissive(verdictFromScanStatus('failed', true))).toBe(false);
  });

  it('【控制样例】执行控制键 / 敏感键剥离不得被移除', () => {
    expect(sanitizeCallerEnv({ PATH: '/evil/bin' }).stripped).toContain('PATH');
    expect(
      sanitizeCallerEnv({ NODE_OPTIONS: '--require /evil.js' }).stripped
    ).toContain('NODE_OPTIONS');
    const stripped = stripSensitiveEnv({
      X_API_KEY: 'k',
      ANOTHER_SECRET: 's',
      KEEP: 'v',
    });
    expect(stripped.X_API_KEY).toBeUndefined();
    expect(stripped.ANOTHER_SECRET).toBeUndefined();
    expect(stripped.KEEP).toBe('v');
  });
});
