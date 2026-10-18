/**
 * 增量测试选择守卫（2026-10-18）。
 *
 * 判据：
 * - 保守回退：代码根之外 / 门禁测试 / 空闭包 / 选中占比 >60% ⇒ 全量；
 * - 纯文档 ⇒ 跳过；**prompts 资源不得被当作文档**（必须全量或选中）；
 * - 反向导入闭包：变更源码 → 受影响测试；
 * - 真实仓库图：变更 `outboundFileRouter.ts` 必须选中其真实测试文件。
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  buildImportGraph,
  decideSelection,
  selectChangedTests,
  type SelectOptions,
} from '../../scripts/select-tests';

const APP_DIR = join(import.meta.dir, '..', '..');

function opts(overrides: Partial<SelectOptions>): SelectOptions {
  return {
    changed: [],
    allTests: [],
    importers: new Map(),
    absToRel: new Map(),
    relToAbs: new Map(),
    ...overrides,
  };
}

describe('decideSelection：保守回退', () => {
  it('空变更 / 代码根之外 / 门禁测试 ⇒ full', () => {
    expect(decideSelection(opts({ changed: [] })).mode).toBe('full');
    expect(decideSelection(opts({ changed: ['app/package.json'] })).mode).toBe(
      'full'
    );
    expect(
      decideSelection(opts({ changed: ['app/tests/gates/x.test.ts'] })).mode
    ).toBe('full');
    expect(
      decideSelection(opts({ changed: ['.github/workflows/ci.yml'] })).mode
    ).toBe('full');
  });

  it('纯文档 ⇒ skip；prompts 资源不算文档', () => {
    expect(
      decideSelection(opts({ changed: ['README.md', 'dev_docs/a.md'] })).mode
    ).toBe('skip');
    // prompts 是运行时资源：不得 skip
    expect(
      decideSelection(
        opts({ changed: ['app/prompts/en-US/sections/identity.md'] })
      ).mode
    ).toBe('full');
  });

  it('反向导入闭包为空 ⇒ full', () => {
    const rel = 'app/src/chat/new-file.ts';
    expect(
      decideSelection(
        opts({ changed: [rel], relToAbs: new Map([[rel, '/tmp/new-file.ts']]) })
      ).mode
    ).toBe('full');
  });

  it('闭包命中测试 ⇒ selected；占比过高 ⇒ full', () => {
    const relA = 'app/src/chat/a.ts';
    const relB = 'app/src/chat/b.ts';
    const relT = 'app/tests/chat/b.test.ts';
    const importers = new Map<string, Set<string>>([
      ['/tmp/a.ts', new Set(['/tmp/b.ts'])],
      ['/tmp/b.ts', new Set(['/tmp/b.test.ts'])],
    ]);
    const relToAbs = new Map([
      [relA, '/tmp/a.ts'],
      [relB, '/tmp/b.ts'],
      [relT, '/tmp/b.test.ts'],
    ]);
    const absToRel = new Map([
      ['/tmp/a.ts', relA],
      ['/tmp/b.ts', relB],
      ['/tmp/b.test.ts', relT],
    ]);
    const selected = decideSelection(
      opts({
        changed: [relA],
        allTests: [relT, 'app/tests/chat/other.test.ts'],
        importers,
        relToAbs,
        absToRel,
      })
    );
    expect(selected.mode).toBe('selected');
    expect(selected.tests).toEqual([relT]);

    const full = decideSelection(
      opts({
        changed: [relA],
        allTests: [relT],
        importers,
        relToAbs,
        absToRel,
      })
    );
    expect(full.mode).toBe('full'); // 1/1 > 60%
  });
});

describe('真实仓库图（反向导入）', () => {
  it('变更 outboundFileRouter.ts ⇒ 选中其真实测试', () => {
    const result = selectChangedTests(APP_DIR, [
      'app/src/channels/routing/outboundFileRouter.ts',
    ]);
    expect(result.mode).toBe('selected');
    expect(result.tests).toContain(
      'app/tests/channels/outboundFileEligibility.test.ts'
    );
  });

  it('变更测试文件自身 ⇒ 必选中自身', () => {
    const rel = 'app/tests/config/ConfigLayersService.test.ts';
    const result = selectChangedTests(APP_DIR, [rel]);
    expect(result.mode).toBe('selected');
    expect(result.tests).toContain(rel);
  });

  it('图包含全部测试文件', () => {
    const { allTests } = buildImportGraph(APP_DIR);
    expect(allTests.length).toBeGreaterThan(500);
  });
});
