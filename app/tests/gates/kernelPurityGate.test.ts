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
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  K04_EXEMPTIONS,
  KERNEL_PUBLIC_SUBPATHS,
  findDanglingExemptions,
} from '../../../scripts/lint-kernel-purity';

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
  // K08 体量棘轮**缺失基线即 fail-closed**（AR-3）。其余用例都只关心 K01–K07，
  // 故默认给一份宽松上限；专测 K08 的用例会自己覆盖同名文件。
  const sizeBaseline = join(
    root,
    '.trae/architecture/kernel-size-baseline.json'
  );
  if (!existsSync(sizeBaseline)) {
    mkdirSync(dirname(sizeBaseline), { recursive: true });
    writeFileSync(
      sizeBaseline,
      JSON.stringify({
        version: 1,
        metrics: { files: 9999, loc: 9999999, dirs: 999 },
      }),
      'utf-8'
    );
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

function run(root: string, args: string[] = []): { code: number; out: string } {
  const result = spawnSync(process.execPath, [GATE, ...args], {
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
      'app/src/core/spi/Util.ts': 'export class UtilImpl {}\n',
      // 显式豁免（K04_EXEMPTIONS）：工具类不是端口实现 ⇒ 不报
      'app/src/core/spi/CacheService.ts':
        'export class TtlCache<T = unknown> { get(): T | undefined { return undefined; } }\n',
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
    // 无 resolve 面的实现类同样报（旧口径会放过它 —— 复审 B2 的绕过口）
    expect(out).toContain('Util.ts');
    // 豁免文件与无关文件不误伤
    expect(out).not.toContain('CacheService.ts');
    expect(out).not.toContain('clean.ts');
  });

  it('K04：改名 resolve / 挪到无 resolve 文件都不能绕过；豁免表外的 class 一律红', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      // ① 解析入口改名（不再叫 resolve*）+ 实现类
      'app/src/core/spi/RenamedPort.ts':
        "export interface IRenamed { ping(): void }\nexport function buildPort(): IRenamed { throw new Error('x'); }\nexport class RenamedImpl { ping(): void {} }\n",
      // ② 只有实现类、连解析入口都没有
      'app/src/core/spi/OnlyImpl.ts': 'export class OnlyImpl {}\n',
      // ③ 非 spi 目录的实现类不受 K04 约束
      'app/src/core/impl/Outside.ts': 'export class OutsideImpl {}\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('K04');
    expect(out).toContain('RenamedPort.ts');
    expect(out).toContain('OnlyImpl.ts');
    expect(out).not.toContain('Outside.ts');
  });

  it('K04 豁免表卫生：幽灵条目被点名；真实仓库当前无幽灵', () => {
    expect(
      findDanglingExemptions(['spi/CacheService.ts'], {
        'spi/CacheService.ts': 'x',
        'spi/Gone.ts': 'y',
      })
    ).toEqual(['spi/Gone.ts']);

    const spiDir = resolve(
      import.meta.dir,
      '../../../packages/kernel/src/core/spi'
    );
    const actual = readdirSync(spiDir)
      .filter((n) => n.endsWith('.ts'))
      .map((n) => `spi/${n}`);
    expect(findDanglingExemptions(actual)).toEqual([]);
    // 豁免表当前确有一条（CacheService）；表被清空时上面这条断言会失去意义
    expect(Object.keys(K04_EXEMPTIONS).length).toBeGreaterThan(0);
  });

  it('模板拼接的动态导入 ⇒ K02（静态不可证，fail-closed）；纯字面量模板 ⇒ 绿', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/tpl-leak.ts':
        'export async function load(n: string): Promise<unknown> {\n  return import(`./dyn/${n}`);\n}\n',
      'app/src/core/tpl-literal.ts':
        'export async function load(): Promise<unknown> {\n  return import(`./dyn`);\n}\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('K02');
    expect(out).toContain('模板拼接');
    expect(out).toContain('tpl-leak.ts');
    // 纯字面量模板（无插值）仍可静态解析 ⇒ 不误伤
    expect(out).not.toContain('tpl-literal.ts');
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

describe('内核纯净度门禁：K06 零 I/O 判据 + I/O 台账', () => {
  const IO_ALLOWLIST = 'scripts/kernel-io-allowlist.json';
  const PURITY_BASELINE = '.trae/architecture/kernel-purity-baseline.json';

  it('npm 依赖 ⇒ 红（K06）；零 I/O 内建（裸写与 `node:` 前缀同权）⇒ 绿', () => {
    const leaking = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/leak-dep.ts':
        "import axios from 'axios';\nexport const a = axios;\n",
    });
    const leakRun = run(leaking);
    expect(leakRun.code).toBe(1);
    expect(leakRun.out).toContain('K06');
    expect(leakRun.out).toContain('axios');

    // 默认白名单（不写配置文件）：只放行零 I/O 内建 —— 裸写 `path` / `crypto` 与带前缀等价
    const clean = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      'app/src/core/ok-dep.ts':
        "import { join } from 'node:path';\nimport { randomUUID } from 'crypto';\nimport { AsyncLocalStorage } from 'node:async_hooks';\nexport const p = join('a', 'b');\nexport const id = randomUUID();\nexport const s = new AsyncLocalStorage();\n",
    });
    const cleanRun = run(clean);
    expect(cleanRun.code).toBe(0);
    expect(cleanRun.out).toContain('三方依赖白名单内');
  });

  it('I/O ⇒ 红（判据是**零 I/O**，不是「可独立安装」）：裸 fs / node:fs / child_process / bun:sqlite 同罪', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [IO_ALLOWLIST]: JSON.stringify({ version: 1, entries: [] }),
      'app/src/core/io.ts':
        "import fs from 'node:fs';\nimport { exec } from 'child_process';\nexport const f = fs;\nexport const e = exec;\nexport const db = require('bun:sqlite');\n",
      // 关键：即使**已经写进基线**，未登记 I/O 照样判红（防「加一处 I/O → 手改基线」合法化）
      [PURITY_BASELINE]: JSON.stringify({
        version: 1,
        maxEntries: 3,
        entries: [
          { file: 'app/src/core/io.ts', rule: 'K06', target: 'node:fs' },
          { file: 'app/src/core/io.ts', rule: 'K06', target: 'child_process' },
          { file: 'app/src/core/io.ts', rule: 'K06', target: 'bun:sqlite' },
        ],
      }),
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('内核 I/O 未登记 3 处');
    expect(out).toContain('node:fs');
    expect(out).toContain('child_process');
    expect(out).toContain('bun:sqlite');
  });

  it('I/O 已登记进台账 + 已进基线 ⇒ 绿，并打印台账条数（P1 迁出后应归零）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [IO_ALLOWLIST]: JSON.stringify({
        version: 1,
        entries: [
          {
            file: 'app/src/core/io.ts',
            specifiers: ['node:fs'],
            target: 'infra/runtime-host',
            note: '夹具：模拟存量登记',
          },
        ],
      }),
      'app/src/core/io.ts': "import fs from 'node:fs';\nexport const f = fs;\n",
      [PURITY_BASELINE]: JSON.stringify({
        version: 1,
        maxEntries: 1,
        entries: [
          { file: 'app/src/core/io.ts', rule: 'K06', target: 'node:fs' },
        ],
      }),
    });

    const { code, out } = run(root);

    expect(code).toBe(0);
    expect(out).toContain('内核 I/O 台账：1 处已登记');
  });

  it('台账里的幽灵条目 ⇒ 告警但 exit 0（同 K04 豁免表卫生口径）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [IO_ALLOWLIST]: JSON.stringify({
        version: 1,
        entries: [
          {
            file: 'app/src/core/gone.ts',
            specifiers: ['fs'],
            target: 'infra/runtime-host',
          },
        ],
      }),
      'app/src/core/clean.ts': 'export const ok = 1;\n',
    });

    const { code, out } = run(root);

    expect(code).toBe(0);
    expect(out).toContain('已无对应违规');
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
        "import { a } from '@openliri/kernel/errors.js';\nimport { b } from '@openliri/kernel/events/EventBus.js';\nimport { c } from '@openliri/kernel/connections/ConnectionRegistry';\nexport const y = [a, b, c];\n",
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

  it('相对路径直连内核源码 ⇒ 红（绕过别名/白名单的口子）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN_KERNEL]: 'export const ok = 1;\n',
      // `app/src/consumer.ts` → `../../packages/kernel/src/core/paths`（裸目录布局，与真实仓库一致）
      'packages/kernel/src/core/paths.ts': 'export const p = 1;\n',
      'app/src/consumer.ts':
        "import { p } from '../../packages/kernel/src/core/paths';\nexport const y = p;\n",
      [DEEP_BASELINE]: EMPTY_DEEP,
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('[相对]');
    expect(out).toContain('app/src/consumer.ts');
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
    // 反向（2026-10-24 评审 A3）：exports **不得**出现通配。
    // `"./spi/*"` 这类目录通配会把 dist 下每个内部文件都变成公开 API，
    // 而收窄公开面属破坏性变更（需 major）⇒ 只能在发布前拦住。
    expect(keys.filter((k) => k.includes('*'))).toEqual([]);
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

describe('内核导出面：ABI 分级 + 转出面棘轮（AC-14 / AC-06）', () => {
  const SURFACE = resolve(
    import.meta.dir,
    '../../../scripts/kernel-api-surface.ts'
  );
  const KERNEL = 'packages/kernel/src/core';
  const SNAPSHOT = '.trae/architecture/kernel-api-surface.json';

  /** 造一个最小 repo：内核只导出 foo.ts#Foo；snapshot 由调用方给 */
  function surfaceFixture(opts: {
    facade: boolean;
    registered: boolean;
  }): string {
    const files: Record<string, string> = {
      [`${KERNEL}/foo.ts`]: 'export const Foo = 1;\n',
      [`${KERNEL}/index.ts`]: "export * from './foo';\n",
    };
    if (opts.facade)
      files['app/src/facade.ts'] = "export { Foo } from '@openliri/kernel';\n";
    // Foo 有外部消费者（门面即消费者）⇒ stable；否则 internal
    const level = opts.facade ? 'stable' : 'internal';
    files[SNAPSHOT] = JSON.stringify({
      version: 3,
      kernelRoot: KERNEL,
      fileCount: 1,
      symbolCount: 1,
      levelCounts: { stable: 0, experimental: 0, internal: 0 },
      entries: [{ file: 'foo.ts', symbols: ['Foo'] }],
      levels: { 'foo.ts#Foo': level },
      reexportFacades: opts.registered
        ? ['app/src/facade.ts -> @openliri/kernel']
        : [],
    });
    return fixture(files);
  }

  function runSurface(root: string): { code: number; out: string } {
    const r = spawnSync(process.execPath, [SURFACE, '--check'], {
      cwd: root,
      env: {
        ...process.env,
        KAS_REPO_ROOT: root,
        KAS_KERNEL_ROOT: join(root, KERNEL),
        KAS_SNAPSHOT: join(root, SNAPSHOT),
      },
      encoding: 'utf-8',
    });
    return {
      code: r.status ?? -1,
      out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    };
  }

  it('未登记级别 ⇒ 红（AC-14「未登记导出 0」）；分级漂移 ⇒ 红', () => {
    const missingLevel = fixture({
      [`${KERNEL}/foo.ts`]: 'export const Foo = 1;\n',
      [SNAPSHOT]: JSON.stringify({
        version: 3,
        kernelRoot: KERNEL,
        fileCount: 1,
        symbolCount: 1,
        levelCounts: { stable: 0, experimental: 0, internal: 1 },
        entries: [{ file: 'foo.ts', symbols: ['Foo'] }],
        levels: {}, // 快照里没有登记
        reexportFacades: [],
      }),
    });
    const r = runSurface(missingLevel);
    expect(r.code).toBe(1);
    expect(r.out).toContain('ABI 分级');

    const drifted = surfaceFixture({ facade: true, registered: true });
    // 把快照里的级别改成 internal（模拟 stable → internal 的收缩）
    const p = join(drifted, SNAPSHOT);
    const snap = JSON.parse(readFileSync(p, 'utf-8')) as {
      levels: Record<string, string>;
    };
    snap.levels['foo.ts#Foo'] = 'internal';
    writeFileSync(p, JSON.stringify(snap));
    const d = runSurface(drifted);
    expect(d.code).toBe(1);
    expect(d.out).toContain('分级漂移');
  });

  it('转出面：已登记 ⇒ 绿；**新增**转出式重复 ⇒ 红（AC-06）', () => {
    const ok = surfaceFixture({ facade: true, registered: true });
    expect(runSurface(ok).code).toBe(0);

    const fresh = surfaceFixture({ facade: true, registered: false });
    const r = runSurface(fresh);
    expect(r.code).toBe(1);
    expect(r.out).toContain('未登记的转出式重复');
    expect(r.out).toContain('app/src/facade.ts');
  });

  it('真实仓库：本次快照覆盖全部导出点，且转出面已冻结', () => {
    const live = runSurface(resolve(import.meta.dir, '../../..'));
    expect(live.code).toBe(0);
    expect(live.out).toContain('ABI 分级：');
    expect(live.out).toContain('新增 0');
  });
});

describe('内核单副本不变量（@opentelemetry/api 只允许一份）', () => {
  const REPO = resolve(import.meta.dir, '../../..');

  it('packages/kernel 不得自带 node_modules / lockfile', () => {
    // 2026-10-23 P4 实测过这一次：给内核单独 install 会产生**第二份** `@opentelemetry/api`
    // ⇒ 启动面 +22 文件 / +30KB（棘轮红），且运行期出现两个 OTel 实例（追踪静默错乱）。
    // 现状是「内核不自带依赖，由 app 单副本供血」；此断言把该形态钉住。
    expect(existsSync(join(REPO, 'packages/kernel/node_modules'))).toBe(false);
    expect(existsSync(join(REPO, 'packages/kernel/bun.lock'))).toBe(false);
    expect(existsSync(join(REPO, 'packages/kernel/bun.lockb'))).toBe(false);
  });

  it('唯一副本在 app/node_modules，且内核 tsconfig 指向它', () => {
    expect(
      existsSync(join(REPO, 'app/node_modules/@opentelemetry/api/package.json'))
    ).toBe(true);
    const ts = JSON.parse(
      readFileSync(join(REPO, 'packages/kernel/tsconfig.json'), 'utf-8')
    ) as { compilerOptions?: { paths?: Record<string, string[]> } };
    const mapped = ts.compilerOptions?.paths?.['@opentelemetry/api']?.[0];
    expect(mapped).toContain('app/node_modules/@opentelemetry/api');
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

/**
 * K08 体量棘轮（`core-减重盘点清单.md` §6）。
 *
 * 三例分别锁住：① 超上限必红；② 基线缺失 fail-closed（AR-3：不得把"没基线"当"零违规"）；
 * ③ `--write-baseline` 只能把上限**下调**，不能顺手放宽。
 */
describe('内核体量棘轮（K08）：只减不增', () => {
  const CLEAN = 'app/src/core/clean.ts';
  const sizeBaseline = (metrics: Record<string, number>): string =>
    JSON.stringify({ version: 1, metrics });

  it('体量超上限 ⇒ 红（并指出是哪个指标）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN]: 'export const ok = 1;\n',
      '.trae/architecture/kernel-size-baseline.json': sizeBaseline({
        files: 0,
        loc: 0,
        dirs: 0,
      }),
    });

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('K08');
    expect(out).toContain('files 1 > 0');
  });

  it('体量基线缺失 ⇒ 红（fail-closed，不得当成零违规）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN]: 'export const ok = 1;\n',
    });
    rmSync(join(root, '.trae/architecture/kernel-size-baseline.json'));

    const { code, out } = run(root);

    expect(code).toBe(1);
    expect(out).toContain('体量基线缺失');
  });

  it('`--write-baseline` 只下调（宽松上限被收紧到当前实测，不会被放大）', () => {
    const root = fixture({
      'scripts/modules-to-layers.json': LAYERS,
      [CLEAN]: 'export const ok = 1;\n',
      '.trae/architecture/kernel-size-baseline.json': sizeBaseline({
        files: 9999,
        loc: 9999999,
        dirs: 999,
      }),
    });

    const write = run(root, ['--write-baseline']);
    expect(write.code).toBe(0);

    const written = JSON.parse(
      readFileSync(
        join(root, '.trae/architecture/kernel-size-baseline.json'),
        'utf-8'
      )
    ) as { metrics: Record<string, number> };

    expect(written.metrics.files).toBe(1);
    expect(written.metrics.files).toBeLessThan(9999);
    expect(written.metrics.dirs).toBe(0);
  });
});
