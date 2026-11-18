// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `lint:dream-exports` 的**负向自证**（AR-3：门禁必须能红，不能被当成装饰）。
 *
 * 三条判据各配一个违规夹具，另加一条「结构被改坏」夹具 —— 全部要求脚本**非零退出**
 * 且输出点名对应判据；合法夹具要求退出 0。夹具根经 `PYAPP_PROJECT_DIR` 注入，
 * 真实仓库文件一律不碰。
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const GATE = resolve(import.meta.dir, '../../scripts/lint-dream-exports.ts');

interface FixtureOptions {
  /** `exports` 键 → 相对 `packages/dream` 的目标；`null` ⇒ 不写 exports */
  exports?: Record<string, string> | null;
  /** 在默认 10 键 exports 上做增删（用于构造 D01 / D02 违规） */
  patchExports?: (map: Record<string, string>) => Record<string, string>;
  /** 夹具内 `app/src/<name>` 的内容（用于 D03） */
  appSource?: string;
}

/** 造一个最小工程树；返回根目录 */
function makeFixture(options: FixtureOptions): string {
  const root = mkdtempSync(join(tmpdir(), 'dream-exports-'));
  mkdirSync(join(root, 'packages', 'dream', 'src', 'dream'), {
    recursive: true,
  });
  mkdirSync(join(root, 'app', 'src'), { recursive: true });

  const pkg: Record<string, unknown> = {
    name: '@openliri/dream',
    version: '0.0.0',
  };
  if (options.exports === null) {
    // 不写 exports（AR-3 夹具）
  } else if (options.exports) {
    pkg.exports = options.exports;
  } else {
    const map = buildExports(root);
    pkg.exports = options.patchExports ? options.patchExports(map) : map;
  }
  writeFileSync(
    join(root, 'packages', 'dream', 'package.json'),
    JSON.stringify(pkg, null, 2)
  );
  if (options.appSource) {
    writeFileSync(join(root, 'app', 'src', 'consumer.ts'), options.appSource);
  }
  return root;
}

/** 建 10 个真实存在的源文件 + 对应 exports（满足键数下限） */
function buildExports(root: string): Record<string, string> {
  const map: Record<string, string> = {
    '.': './src/dream/index.ts',
  };
  for (let i = 1; i <= 9; i++) {
    const name = `Mod${i}`;
    const rel = `./src/dream/${name}.ts`;
    writeFileSync(
      join(root, 'packages', 'dream', rel.slice(2)),
      'export const x = 1;\n'
    );
    map[`./${name}`] = rel;
  }
  writeFileSync(
    join(root, 'packages', 'dream', 'src', 'dream', 'index.ts'),
    'export const root = 1;\n'
  );
  return map;
}

function runGate(root: string) {
  const r = spawnSync(process.execPath, ['run', GATE], {
    env: { ...process.env, PYAPP_PROJECT_DIR: root },
    encoding: 'utf-8',
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('lint:dream-exports 负向自证', () => {
  it('合法夹具 ⇒ exit 0', () => {
    const root = makeFixture({});
    try {
      const { code, out } = runGate(root);
      expect(code).toBe(0);
      expect(out).toContain('白名单校验通过');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('D01：出现通配符导出 ⇒ exit 1 并点名 D01', () => {
    const root = makeFixture({
      patchExports: (map) => ({ ...map, './*': './src/dream/*.ts' }),
    });
    try {
      const { code, out } = runGate(root);
      expect(code).toBe(1);
      expect(out).toContain('D01');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('D02：导出指向不存在的文件 ⇒ exit 1 并点名 D02', () => {
    const root = makeFixture({
      patchExports: (map) => ({ ...map, './Gone': './src/dream/Gone.ts' }),
    });
    try {
      const { code, out } = runGate(root);
      expect(code).toBe(1);
      expect(out).toContain('D02');
      expect(out).toContain('Gone.ts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('D03：引用未登记的公开子路径 ⇒ exit 1 并点名 D03', () => {
    const root = makeFixture({
      appSource: "import { x } from '@openliri/dream/NotExported';\n",
    });
    try {
      const { code, out } = runGate(root);
      expect(code).toBe(1);
      expect(out).toContain('D03');
      expect(out).toContain('NotExported');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AR-3：exports 缺失（结构被改坏）⇒ exit 1，不得假绿', () => {
    const root = makeFixture({ exports: null });
    try {
      const { code, out } = runGate(root);
      expect(code).toBe(1);
      expect(out).not.toContain('白名单校验通过');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
