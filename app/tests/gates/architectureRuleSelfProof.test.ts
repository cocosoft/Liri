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
 * 门禁规则级自证：`scripts/lint-architecture.ts`（G1 第一批，2026-11-17）
 *
 * 与 `gateSelfProof.test.ts` 同一机制（临时夹具工程 + 真实脚本 + `PYAPP_PROJECT_DIR='.'`），
 * 但把覆盖面从「跨层 / 文件行数 / 定位错误」扩到**每条 error 级规则的负向 + 正向对照**：
 *
 * | 规则 | 负向样例 | 正向对照 |
 * |---|---|---|
 * | R01-002 错误类同名 | 自定义 `ValidationError` ⇒ 退出 1 | 非标准名继承 Error ⇒ 退出 0（warning 级） |
 * | R01-001 自建事件总线 | `extends EventEmitter` + handler Map ⇒ 退出 1 | 同文件去掉分发方法 ⇒ 退出 0 |
 * | R05-007 tsconfig 盲区 | `exclude: ["src/chat/**"]` ⇒ 退出 1 | 空 exclude ⇒ 退出 0 |
 * | R09-006 状态机登记 | 定义目录缺失 / 未登记 enum ⇒ 退出 1 | enum 已按 `verifyRef` 登记 ⇒ 退出 0 |
 * | R03-002 子目录 import | `@modules/<m>/<sub>` 且目标有 index ⇒ 退出 1 | 走模块桶 ⇒ 退出 0 |
 * | R05-003 Console 基线 | 基线文件缺失 ⇒ 退出 1（fail-closed） | （已有合法夹具覆盖） |
 * | R07-001 微小文件 | — | <10 行文件 ⇒ **退出 0**（warning 不误杀） |
 *
 * 为什么只测 error 级会阻断：`lint-architecture.ts` 的退出码只由 error 决定
 * （warning 打印但 `exit 0`）——这也是「门禁是否静默失效」的核心判据（AR-3）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptsDir = resolve(import.meta.dir, '../../../scripts');

/** 以夹具根为项目根运行门禁脚本；返回退出码与合并输出 */
function runGate(fixtureRoot: string) {
  const r = spawnSync(
    process.execPath,
    ['run', join(scriptsDir, 'lint-architecture.ts')],
    {
      cwd: fixtureRoot,
      env: { ...process.env, PYAPP_PROJECT_DIR: '.' },
      encoding: 'utf-8',
      timeout: 120_000,
    }
  );
  return {
    code: r.status ?? -1,
    output: `${r.stdout ?? ''}\n${r.stderr ?? ''}`,
  };
}

let baseDir = '';

/**
 * 造一个夹具工程。
 *
 * 默认补齐两处**前置**（否则验的是"缺前置"而非目标规则）：
 * - `scripts/console-baseline.json`（R05-003 自 2026-10-14 起 fail-closed）；
 * - `packages/infra/src/state/engine/stateMachineCatalog.ts`（R09-006 定义目录）。
 */
function makeFixture(
  name: string,
  files: Record<string, string>,
  opts: { withConsoleBaseline?: boolean; withCatalog?: boolean } = {}
): string {
  const root = join(baseDir, name);
  mkdirSync(join(root, 'app', 'src'), { recursive: true });

  if (opts.withConsoleBaseline !== false) {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(
      join(root, 'scripts', 'console-baseline.json'),
      JSON.stringify({ count: 100000, threshold: 0 })
    );
  }
  if (opts.withCatalog !== false) {
    const catalogDir = join(
      root,
      'packages',
      'infra',
      'src',
      'state',
      'engine'
    );
    mkdirSync(catalogDir, { recursive: true });
    writeFileSync(
      join(catalogDir, 'stateMachineCatalog.ts'),
      'export const STATE_MACHINES = [];\nexport const BOUNDARY_STATE_MACHINES = [];\n'
    );
  }

  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'arch-rule-selfproof-'));
});

afterAll(() => {
  if (baseDir && existsSync(baseDir)) {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

describe('R5 门禁自证 · 规则级（lint:arch）', () => {
  // ── R01-002 错误类同名 ────────────────────────────────
  it('【违规样例】自定义标准错误名（ValidationError）⇒ 退出 1 且报 R01-002', () => {
    const dir = makeFixture('r01002-bad', {
      'app/src/chat/dupError.ts':
        'export interface ValidationError {\n  code: number;\n}\n',
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R01-002');
  });

  it('【正向对照】非标准名直接 extends Error ⇒ 退出 0（warning 不阻断）', () => {
    const dir = makeFixture('r01002-ok', {
      'app/src/chat/customBoom.ts':
        'export class CustomBoomError extends Error {}\n',
    });
    const r = runGate(dir);
    expect(r.code).toBe(0);
  });

  // ── R01-001 自建事件总线 ──────────────────────────────
  it('【违规样例】extends EventEmitter + handler Map + 分发方法 ⇒ 退出 1 且报 R01-001', () => {
    const dir = makeFixture('r01001-bad', {
      'app/src/chat/localBus.ts': [
        'type Handler = (payload: unknown) => void;',
        'export class LocalBus extends EventEmitter {',
        '  private handlers = new Map<string, Handler>();',
        '  emitAll(name: string): void {',
        '    this.emit(name);',
        '  }',
        '}',
        '',
      ].join('\n'),
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R01-001');
  });

  it('【正向对照】同样继承 EventEmitter 但无 handler Map ⇒ 退出 0', () => {
    const dir = makeFixture('r01001-ok', {
      'app/src/chat/plainSender.ts': [
        'export class PlainSender extends EventEmitter {',
        '  send(name: string): void {',
        '    this.emit(name);',
        '  }',
        '}',
        '',
      ].join('\n'),
    });
    const r = runGate(dir);
    expect(r.code).toBe(0);
  });

  // ── R05-007 tsconfig 盲区 ──────────────────────────────
  it('【违规样例】tsconfig 排除核心目录（src/chat/**）⇒ 退出 1 且报 R05-007', () => {
    const dir = makeFixture('r05007-bad', {
      'app/tsconfig.json': JSON.stringify({ exclude: ['src/chat/**'] }),
      'app/src/chat/probe.ts': 'export const ok = 1;\n',
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R05-007');
  });

  it('【正向对照】tsconfig exclude 为空 ⇒ 退出 0', () => {
    const dir = makeFixture('r05007-ok', {
      'app/tsconfig.json': JSON.stringify({ exclude: [] }),
      'app/src/chat/probe.ts': 'export const ok = 1;\n',
    });
    const r = runGate(dir);
    expect(r.code).toBe(0);
  });

  // ── R09-006 状态机登记 ────────────────────────────────
  it('【违规样例】定义目录缺失 ⇒ 退出 1 且报 R09-006（fail-closed，不静默放行）', () => {
    const dir = makeFixture(
      'r09006-nocatalog',
      { 'app/src/chat/probe.ts': 'export const ok = 1;\n' },
      { withCatalog: false }
    );
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R09-006');
  });

  it('【违规样例】未登记的状态枚举 ⇒ 退出 1 且报 R09-006', () => {
    const dir = makeFixture('r09006-bad', {
      'app/src/chat/taskState.ts':
        "export enum TaskStatus {\n  Ready = 'ready',\n}\n",
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R09-006');
  });

  it('【正向对照】状态枚举已按 verifyRef 登记 ⇒ 退出 0', () => {
    const dir = makeFixture('r09006-ok', {
      'app/src/chat/taskState.ts':
        "export enum TaskStatus {\n  Ready = 'ready',\n}\n",
      'packages/infra/src/state/engine/stateMachineCatalog.ts': [
        'export const STATE_MACHINES = [',
        "  { verifyRef: { module: 'app/src/chat/taskState.ts', exportName: 'TaskStatus' } },",
        '];',
        'export const BOUNDARY_STATE_MACHINES = [];',
        '',
      ].join('\n'),
    });
    const r = runGate(dir);
    expect(r.code).toBe(0);
  });

  // ── R03-002 模块出口单一 ─────────────────────────────
  it('【违规样例】跨模块子目录 import（目标有 index.ts）⇒ 退出 1 且报 R03-002', () => {
    const dir = makeFixture('r03002-bad', {
      'app/src/infrastructure/index.ts':
        "export * from './http/handlers/thing';\n",
      'app/src/infrastructure/http/handlers/thing.ts': 'export const t = 1;\n',
      'app/src/chat/probe.ts':
        "import { t } from '@modules/infrastructure/http/handlers/thing';\nexport const x = t;\n",
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R03-002');
  });

  it('【正向对照】走模块桶（@modules/infrastructure）⇒ 退出 0', () => {
    const dir = makeFixture('r03002-ok', {
      'app/src/infrastructure/index.ts':
        "export * from './http/handlers/thing';\n",
      'app/src/infrastructure/http/handlers/thing.ts': 'export const t = 1;\n',
      'app/src/chat/probe.ts':
        "import { t } from '@modules/infrastructure';\nexport const x = t;\n",
    });
    const r = runGate(dir);
    expect(r.code).toBe(0);
  });

  // ── R05-003 Console 基线（fail-closed）─────────────────
  it('【违规样例】基线文件缺失 ⇒ 退出 1 且报 R05-003（不得回退硬编码默认值）', () => {
    const dir = makeFixture(
      'r05003-missing',
      { 'app/src/chat/probe.ts': 'export const ok = 1;\n' },
      { withConsoleBaseline: false }
    );
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R05-003');
  });

  // ── 多条 error 并行 ──────────────────────────────────
  it('【组合样例】两个 error 同时存在 ⇒ 两条规则都出现在输出（不得只报第一条）', () => {
    const dir = makeFixture('multi-error', {
      'app/src/chat/dupError.ts':
        'export interface ValidationError {\n  code: number;\n}\n',
      'app/src/infrastructure/index.ts':
        "export * from './http/handlers/thing';\n",
      'app/src/infrastructure/http/handlers/thing.ts': 'export const t = 1;\n',
      'app/src/chat/probe.ts':
        "import { t } from '@modules/infrastructure/http/handlers/thing';\nexport const x = t;\n",
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain('R01-002');
    expect(r.output).toContain('R03-002');
  });

  // ── warning 级不阻断（防"警告变阻断"或"警告被吞"两边漂移）────
  it('【正向对照】<10 行微小文件 ⇒ 退出 0，但 R07-001 仍须出现在输出里', () => {
    const dir = makeFixture('r07001-warn', {
      'app/src/chat/tiny.ts': 'export const a = 1;\n',
    });
    const r = runGate(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain('R07-001');
  });

  // ── 边界：恰好 2000 行不触发 R04-001 ───────────────────
  it('【边界样例】拆分后恰好 2000 行 ⇒ 退出 0（上限是"超过"才拦）', () => {
    // 注意：门禁按 `content.split('\n').length` 计数 ⇒ N 行正文 + 结尾换行 = N+1。
    // 故 1999 行正文 + 换行 = 2000，恰好落在边界上不触发。
    const body = Array.from(
      { length: 1999 },
      (_, i) => `export const v${i} = ${i};`
    ).join('\n');
    const dir = makeFixture('r04001-edge', {
      'app/src/chat/exact.ts': `${body}\n`,
    });
    const r = runGate(dir);
    expect(r.code).toBe(0);
  });
});
