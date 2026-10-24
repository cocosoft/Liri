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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KERNEL_PUBLIC_SUBPATHS } from '../../../scripts/lint-kernel-purity';

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
    // 夹具沿用 `app/src/core` 布局（与真实仓库的 `packages/kernel/src/core` 不同），
    // 故显式指定内核根 —— 该 env 就是为此类夹具预留的。
    env: {
      ...process.env,
      KP_REPO_ROOT: root,
      KP_KERNEL_ROOT: join(root, 'app', 'src', 'core'),
    },
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
        "import { helper } from '@openliri/kernel/helper';\nimport type { T } from '@modules/types';\nexport const ok: T = helper();\n",
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
      env: {
        ...process.env,
        KP_REPO_ROOT: root,
        KP_KERNEL_ROOT: join(root, 'app', 'src', 'core'),
      },
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

describe('内核纯净度门禁：K07 深路径（消费方）自证', () => {
  const DEEP_BASELINE = '.trae/architecture/kernel-deep-path-baseline.json';
  /** 门禁要求内核根目录存在（否则直接 exit 1 "内核根目录不存在"），夹具补一个干净文件 */
  const CLEAN_KERNEL = 'app/src/core/clean.ts';
  const EMPTY_DEEP = JSON.stringify({ version: 1, maxEntries: 0, entries: [] });

  it('非白名单首段 ⇒ 红，并点名文件与说明符', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN_KERNEL]: 'export const ok = 1;\n',
      'app/src/consumer.ts':
        "import { x } from '@openliri/kernel/secretSubpath';\nexport const y = x;\n",
      [DEEP_BASELINE]: EMPTY_DEEP,
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('K07 新增内核深路径');
    expect(out).toContain('app/src/consumer.ts');
    expect(out).toContain('@openliri/kernel/secretSubpath');
  });

  it('白名单首段（含 `.js` 后缀与子目录）⇒ 绿，且 0 处', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN_KERNEL]: 'export const ok = 1;\n',
      'app/src/consumer.ts':
        "import { a } from '@openliri/kernel/paths.js';\nimport { b } from '@openliri/kernel/events/EventBus.js';\nimport { c } from '@openliri/kernel/idle/IdleScaleMonitor';\nexport const y = [a, b, c];\n",
      [DEEP_BASELINE]: EMPTY_DEEP,
    });

    const { code, out } = run(root);

    expect(code).toBe(0);
    expect(out).toContain('K07 深路径：0 处');
  });

  it('匹配粒度 = 首段：`foo.js` 与 `foo/bar` 同归 `foo`（`.js` 不参与比较）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN_KERNEL]: 'export const ok = 1;\n',
      'app/src/consumer.ts':
        "import { a } from '@openliri/kernel/foo.js';\nimport { b } from '@openliri/kernel/foo/bar';\nexport const y = [a, b];\n",
      [DEEP_BASELINE]: EMPTY_DEEP,
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    // 两处说明符不同 ⇒ 两条记录，但同属 `foo` 首段
    expect(out).toContain('@openliri/kernel/foo.js');
    expect(out).toContain('@openliri/kernel/foo/bar');
  });

  it('基线已登记 ⇒ 绿；条目数 > maxEntries ⇒ 红（硬上限）', () => {
    const entry = { file: 'app/src/consumer.ts', subpath: 'secretSubpath' };
    const registered = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN_KERNEL]: 'export const ok = 1;\n',
      'app/src/consumer.ts':
        "import { x } from '@openliri/kernel/secretSubpath';\nexport const y = x;\n",
      [DEEP_BASELINE]: JSON.stringify({
        version: 1,
        maxEntries: 1,
        entries: [entry],
      }),
    });
    expect(run(registered).code).toBe(0);

    const overCap = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN_KERNEL]: 'export const ok = 1;\n',
      'app/src/consumer.ts':
        "import { x } from '@openliri/kernel/secretSubpath';\nexport const y = x;\n",
      [DEEP_BASELINE]: JSON.stringify({
        version: 1,
        maxEntries: 0,
        entries: [entry],
      }),
    });
    const overRun = run(overCap);
    expect(overRun.code).toBe(1);
    expect(overRun.out).toContain('K07 基线条目数超上限');
  });
});

describe('内核公开面三处一致（防漂移）', () => {
  const REPO = resolve(import.meta.dir, '../../..');
  /** 从 `@openliri/kernel/<x>` / `./<x>` 里取**首段前缀**（去掉前导、`/*` 与 `.js`） */
  const prefixOf = (spec: string): string =>
    spec
      .replace(/^(\.\/|@openliri\/kernel\/)/, '')
      .replace(/(\.js|\/\*)$/, '')
      .split('/')[0] as string;

  const tsconfigKeys = (): string[] => {
    const raw = readFileSync(join(REPO, 'app/tsconfig.json'), 'utf-8');
    const paths = (
      JSON.parse(raw) as {
        compilerOptions: { paths: Record<string, string[]> };
      }
    ).compilerOptions.paths;
    return Object.keys(paths)
      .filter((k) => k.startsWith('@openliri/kernel/'))
      .map((k) => k.slice('@openliri/kernel/'.length));
  };

  const exportKeys = (): string[] => {
    const raw = readFileSync(
      join(REPO, 'packages/kernel/package.json'),
      'utf-8'
    );
    const exp = (JSON.parse(raw) as { exports: Record<string, unknown> })
      .exports;
    return Object.keys(exp).filter((k) => k !== '.' && k !== './package.json');
  };

  it('① tsconfig 判定：每个公开子路径都有显式映射，且**不留**全量通配', () => {
    const keys = tsconfigKeys();
    // 全量通配会让「未公开的深路径」在仓内假绿（发布后才 404）—— 必须不存在
    expect(keys).not.toContain('*');
    for (const p of KERNEL_PUBLIC_SUBPATHS) {
      expect(keys.some((k) => prefixOf(k) === p)).toBe(true);
    }
  });

  it('② exports 判定：每个公开子路径都能被 npm 解析，且目标文件真实存在', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO, 'packages/kernel/package.json'), 'utf-8')
    ) as {
      exports: Record<string, { types?: string; import?: string } | string>;
    };
    const keys = exportKeys();
    for (const p of KERNEL_PUBLIC_SUBPATHS) {
      expect(keys.some((k) => prefixOf(k) === p)).toBe(true);
    }
    // 非通配条目：目标必须是真实存在的源文件映射（`dist/x.js` ⇔ `src/x.ts`）。
    // **不依赖 dist**（CI 测试 job 不构建内核），但能抓出拼错 / 指向已删模块的条目。
    const srcOf = (target: string): string =>
      target
        .replace('./dist/', './src/')
        .replace(/\.d\.ts$/, '.ts')
        .replace(/\.js$/, '.ts');
    for (const [k, v] of Object.entries(pkg.exports)) {
      if (k === '.' || k === './package.json' || k.includes('*')) continue;
      for (const target of [v].flatMap((x) =>
        typeof x === 'string' ? [x] : [x.types, x.import]
      )) {
        if (!target) continue;
        expect(existsSync(join(REPO, 'packages/kernel', srcOf(target)))).toBe(
          true
        );
      }
    }
  });

  it('③ 反向：tsconfig / exports 里没有「不在公开清单」的前缀', () => {
    const allowed = new Set<string>(KERNEL_PUBLIC_SUBPATHS);
    for (const k of tsconfigKeys()) expect(allowed.has(prefixOf(k))).toBe(true);
    for (const k of exportKeys()) expect(allowed.has(prefixOf(k))).toBe(true);
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
