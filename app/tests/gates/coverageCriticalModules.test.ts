/**
 * 覆盖率 · 关键模块专属门槛（2026-11-01）。
 *
 * 背景：CI 只有全局 18% 门槛，全局达标会掩盖"关键模块 0 覆盖"。本门禁让指定关键模块
 * 各自带下限，且**在 lcov 里查不到也算失败**（未被任何测试导入 ⇒ 0 覆盖）。
 *
 * 覆盖：① lcov 按文件解析；② 达标/低于/缺失三种判定；③ 目录前缀与绝对路径匹配；
 * ④ CLI 端到端（合成 lcov + 临时配置，断言退出码）。
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  evaluateCriticalModules,
  normalizeCoveragePath,
  parseLcovByFile,
  type CriticalCoverageConfig,
} from '../../scripts/coverageCriticalCore';

const SCRIPT = resolve(
  import.meta.dir,
  '../../scripts/check-coverage-threshold.ts'
);

function lcov(entries: Array<[string, number, number]>): string {
  return entries
    .map(([file, total, covered]) => {
      const da = Array.from(
        { length: total },
        (_, i) => `DA:${i + 1},${i < covered ? 1 : 0}`
      ).join('\n');
      return `SF:${file}\n${da}\nend_of_record`;
    })
    .join('\n');
}

describe('关键模块覆盖率门槛（纯逻辑）', () => {
  it('按文件解析 lcov（反斜杠归一化，忽略无 DA 的文件）', () => {
    const files = parseLcovByFile(
      lcov([
        ['src\\a\\b.ts', 4, 3],
        ['src/empty.ts', 0, 0],
      ])
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      file: 'src/a/b.ts',
      totalLines: 4,
      coveredLines: 3,
    });
  });

  it('达标 / 低于下限 / 未出现在 lcov 三种判定', () => {
    const files = parseLcovByFile(
      lcov([
        ['src/good.ts', 10, 10],
        ['src/bad.ts', 10, 5],
      ])
    );
    const config: CriticalCoverageConfig = {
      modules: [
        { path: 'src/good.ts', minLineCoverage: 90 },
        { path: 'src/bad.ts', minLineCoverage: 90 },
        { path: 'src/missing.ts', minLineCoverage: 10 },
      ],
    };
    const [good, bad, missing] = evaluateCriticalModules(files, config);

    expect(good.pass).toBe(true);
    expect(good.percent).toBe(100);

    expect(bad.pass).toBe(false);
    expect(bad.percent).toBe(50);
    expect(String(bad.reason)).toContain('50%');

    expect(missing.pass).toBe(false);
    expect(String(missing.reason)).toContain('未出现在 lcov');
  });

  it('目录前缀与绝对路径都能命中；同目录多文件按行数合并', () => {
    const files = parseLcovByFile(
      lcov([
        ['E:/repo/app/src/query/a.ts', 10, 10],
        ['src/query/b.ts', 10, 0],
      ])
    );
    const [rule] = evaluateCriticalModules(files, {
      modules: [{ path: 'src/query/', minLineCoverage: 40 }],
    });
    expect(rule.matchedFiles).toBe(2);
    expect(rule.percent).toBe(50);
    expect(rule.pass).toBe(true);
  });

  it('normalizeCoveragePath 去 ./ 前缀并统一分隔符', () => {
    expect(normalizeCoveragePath('./src\\x.ts')).toBe('src/x.ts');
  });
});

describe('关键模块覆盖率门槛（CLI 端到端）', () => {
  const dirs: string[] = [];

  function runCase(
    files: Array<[string, number, number]>,
    modules: Array<{ path: string; minLineCoverage: number }>
  ): number {
    const dir = mkdtempSync(join(tmpdir(), 'liri-cov-critical-'));
    dirs.push(dir);
    const lcovPath = join(dir, 'lcov.info');
    const configPath = join(dir, 'critical.json');
    writeFileSync(lcovPath, lcov(files));
    writeFileSync(configPath, JSON.stringify({ modules }));
    const result = spawnSync(process.execPath, [SCRIPT, '1'], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        COVERAGE_LCOV_FILE: lcovPath,
        COVERAGE_CRITICAL_CONFIG: configPath,
      },
    });
    rmSync(dir, { recursive: true, force: true });
    return result.status ?? -1;
  }

  it('全部达标 ⇒ exit 0', () => {
    expect(
      runCase(
        [['src/a.ts', 10, 10]],
        [{ path: 'src/a.ts', minLineCoverage: 90 }]
      )
    ).toBe(0);
  });

  it('低于下限 ⇒ exit 1', () => {
    expect(
      runCase(
        [['src/a.ts', 10, 2]],
        [{ path: 'src/a.ts', minLineCoverage: 90 }]
      )
    ).toBe(1);
  });

  it('配置里的模块在 lcov 查不到 ⇒ exit 1（不接受沉默通过）', () => {
    expect(
      runCase(
        [['src/other.ts', 10, 10]],
        [{ path: 'src/never-imported.ts', minLineCoverage: 1 }]
      )
    ).toBe(1);
  });
});
