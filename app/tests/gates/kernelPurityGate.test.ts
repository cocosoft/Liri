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
 * 内核纯净度门禁（`scripts/lint-kernel-purity.ts`）**自证**。
 *
 * **为什么需要**（同 `gateSelfProof` 的取向）：门禁"绿"只说明当时没报，
 * 不说明它**真的会报** —— 正则写错、路径漂移、注释剥离失效都会让它静默返回 0。
 * 本文件用**临时夹具工程**跑真实脚本，成对断言：
 *   ① 违规样例必红（K01/K02/K03/K04 各自可被单独触发）；
 *   ② 合法样例必绿；
 *   ③ 违规已登记进基线 ⇒ 绿（棘轮口径）；
 *   ④ 基线项已无违规 ⇒ 绿且提示"可下调基线"。
 *
 * 夹具通过 `KP_REPO_ROOT` 指到临时目录（脚本其余默认路径都相对 repoRoot 推导）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const GATE = resolve(import.meta.dir, '../../../scripts/lint-kernel-purity.ts');

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'kernel-purity-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return root;
}

/** 夹具固定层表：core 为内核层，appx 为上层 */
const LAYERS = JSON.stringify({
  modules: {
    core: { layer: 'core' },
    types: { layer: 'core' },
    appx: { layer: 'app' },
  },
});

function baseline(entries: Array<Record<string, string>>): string {
  return JSON.stringify({ version: 1, entries }, null, 2);
}

function run(root: string): { code: number; out: string } {
  const result = spawnSync(process.execPath, [GATE], {
    cwd: root,
    env: { ...process.env, KP_REPO_ROOT: root },
    encoding: 'utf-8',
  });
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('内核纯净度门禁：违规样例必红', () => {
  it('K01 静态跨层 / K02 动态跨层 / K03 出工作区 / K04 端口导出实现类 都能被单独报出', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/clean.ts':
        "import { helper } from '@modules/core/helper';\nimport type { T } from '@modules/types';\nexport const ok: T = helper();\n",
      'app/src/core/leak-static.ts':
        "import { thing } from '@modules/appx';\nexport const x = thing;\n",
      'app/src/core/leak-dynamic.ts':
        "export async function load(): Promise<unknown> {\n  return import('@modules/appx');\n}\n",
      'app/src/core/leak-outside.ts':
        "import { shared } from '../../../client/src/shared';\nexport const s = shared;\n",
      'app/src/core/spi/Port.ts':
        "export interface IPort { ping(): void }\nexport function resolvePort(): IPort { throw new Error('x'); }\nexport class PortImpl { ping(): void {} }\n",
      'app/src/core/spi/Util.ts': 'export class TtlCache {}\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('K01');
    expect(out).toContain('leak-static.ts');
    expect(out).toContain('K02');
    expect(out).toContain('leak-dynamic.ts');
    expect(out).toContain('K03');
    expect(out).toContain('leak-outside.ts');
    expect(out).toContain('K04');
    // 白名单不误伤：非端口文件里的 class、以及 core 内部引用都不报
    expect(out).not.toContain('Util.ts');
    expect(out).not.toContain('clean.ts');
  });

  it('注释里的 import 不算违规（注释剥离有效）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/doc-only.ts':
        "// 历史：曾 import { x } from '@modules/appx'\n/* 动态示例：await import('@modules/appx') */\nexport const y = 1; // 见 https://example.com/import('@modules/appx')\n",
    });

    const { code, out } = run(root);

    expect(code).toBe(0);
    expect(out).toContain('无新增内核泄漏');
  });
});

describe('内核纯净度门禁：K06 第三方依赖白名单', () => {
  it('npm 依赖 ⇒ 红（K06）；Node/Bun 内建与显式允许的包 ⇒ 绿', () => {
    const leaking = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/leak-dep.ts':
        "import axios from 'axios';\nexport const a = axios;\n",
    });
    const leakRun = run(leaking);
    expect(leakRun.code).toBe(1);
    expect(leakRun.out).toContain('K06');
    expect(leakRun.out).toContain('axios');

    const clean = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/ok-dep.ts':
        "import { join } from 'node:path';\nimport fs from 'fs';\nimport { describe } from 'bun:test';\nexport const p = join('a', 'b');\nexport const f = fs;\nexport const d = describe;\n",
      'scripts/kernel-allowed-deps.json': JSON.stringify({
        version: 1,
        allowedPrefixes: ['node:', 'bun:'],
        allowBareBuiltins: true,
        allowedPackages: ['@opentelemetry/api'],
      }),
    });
    const cleanRun = run(clean);
    expect(cleanRun.code).toBe(0);
    expect(cleanRun.out).toContain('三方依赖白名单内');
  });
});

describe('内核纯净度门禁：未登记模块 fail-closed', () => {
  it('引用层表里没有的模块 ⇒ 红（此前只进 warning，可被绕过）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/leak-unmapped.ts':
        "import { x } from '@modules/brand-new-module';\nexport const y = x;\n",
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('未登记层归属');
    expect(out).toContain('brand-new-module');
  });
});

describe('内核纯净度门禁：基线 maxEntries 棘轮', () => {
  it('条目数超过 maxEntries ⇒ 红（想加条目必须手改 json）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/leak.ts':
        "import { thing } from '@modules/appx';\nexport const x = thing;\n",
      '.trae/architecture/kernel-purity-baseline.json': JSON.stringify({
        version: 1,
        maxEntries: 0,
        entries: [
          { file: 'app/src/core/leak.ts', rule: 'K01', target: 'appx' },
        ],
      }),
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('maxEntries');
  });

  it('--write-baseline 只能下调 maxEntries', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/clean.ts': 'export const ok = 1;\n',
      '.trae/architecture/kernel-purity-baseline.json': JSON.stringify({
        version: 1,
        maxEntries: 5,
        entries: [],
      }),
    });

    const result = spawnSync(process.execPath, [GATE, '--write-baseline'], {
      cwd: root,
      env: { ...process.env, KP_REPO_ROOT: root },
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);

    const written = JSON.parse(
      readFileSync(
        join(root, '.trae/architecture/kernel-purity-baseline.json'),
        'utf-8'
      )
    ) as { maxEntries?: number; entries: unknown[] };
    expect(written.entries.length).toBe(0);
    expect(written.maxEntries).toBe(0); // 5 → 0（下调），绝不上调
  });
});

describe('内核纯净度门禁：字符串字面量不误报', () => {
  it("数组里的 'from' 不被当成模块说明符", () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/words.ts':
        "export const WORDS = [\n  'by',\n  'from',\n  'about',\n];\n",
    });

    const { code, out } = run(root);

    expect(code).toBe(0);
    // 违规行形如 `- K0x <file>:<line> → <target>`；banner 里也有 "K01"，故按文件行断言
    expect(out).not.toMatch(/- K0[0-9] .*words\.ts:/);
    expect(out).toContain('无新增内核泄漏');
  });
});

describe('内核纯净度门禁：基线与棘轮', () => {
  const LEAK =
    "import { thing } from '@modules/appx';\nexport const x = thing;\n";

  it('违规已登记进基线 ⇒ 绿（棘轮维持）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/leak.ts': LEAK,
      '.trae/architecture/kernel-purity-baseline.json': baseline([
        { file: 'app/src/core/leak.ts', rule: 'K01', target: 'appx' },
      ]),
    });

    const { code, out } = run(root);

    expect(code).toBe(0);
    expect(out).toContain('均已登记');
  });

  it('基线项已无违规 ⇒ 绿且提示可下调基线（不判红）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/clean.ts': 'export const ok = 1;\n',
      '.trae/architecture/kernel-purity-baseline.json': baseline([
        { file: 'app/src/core/leak.ts', rule: 'K01', target: 'appx' },
      ]),
    });

    const { code, out } = run(root);

    expect(code).toBe(0);
    expect(out).toContain('请下调基线');
  });

  it('基线外的**新增**泄漏 ⇒ 红（只允许减少）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/leak.ts': LEAK,
      'app/src/core/leak2.ts': LEAK,
      '.trae/architecture/kernel-purity-baseline.json': baseline([
        { file: 'app/src/core/leak.ts', rule: 'K01', target: 'appx' },
      ]),
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('leak2.ts');
    expect(out).not.toContain('leak.ts:1');
  });
});
