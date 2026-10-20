/**
 * 启动面静态图棘轮 · **负向自证**（静态导入图瘦身 P1）
 *
 * 复用纯逻辑（`app/scripts/startupGraphCore.ts`）—— 不在测试里跑真实构建（保测试快）。
 * 断言：
 *  ① 持平 ⇒ 通过；② 任意一项增长 ⇒ 必报；③ 缩小 ⇒ 通过并提示下调基线；
 *  ④ 非法基线 / 入口不一致 ⇒ 必报（不得静默通过）；
 *  ⑤ **端到端口径**：新增一条**静态**边 ⇒ eager 文件数 +1 ⇒ 报错；同一条边改成
 *     `dynamic-import` ⇒ 不计入（证明"棘轮只拦启动期真加载"）。
 */
import { describe, expect, it } from 'bun:test';

import {
  compareStartupGraph,
  summarizeEager,
  toBaseline,
  type StartupGraphBaseline,
  type StartupMeta,
} from '../../scripts/startupGraphCore.js';

/** 构造一个最小 metafile：entry → a（静态）→ b（由 kind 决定静态/动态） */
function makeMeta(kind: 'import-statement' | 'dynamic-import'): StartupMeta {
  return {
    inputs: {
      'src/pyapp.ts': {
        bytes: 100,
        imports: [{ path: 'src/main.ts', kind: 'import-statement' }],
      },
      'src/main.ts': {
        bytes: 200,
        imports: [{ path: 'src/core/b.ts', kind }],
      },
      'src/core/b.ts': { bytes: 300, imports: [] },
    },
  };
}

const ENTRY = 'src/pyapp.ts';

function baselineOf(meta: StartupMeta): StartupGraphBaseline {
  return toBaseline(summarizeEager(meta, ENTRY));
}

describe('启动面静态图棘轮 · 负向自证', () => {
  it('持平 ⇒ 无违规、无缩小提示', () => {
    const meta = makeMeta('import-statement');
    const comparison = compareStartupGraph(
      summarizeEager(meta, ENTRY),
      baselineOf(meta)
    );
    expect(comparison.problems).toEqual([]);
    expect(comparison.shrink).toBeNull();
  });

  it('**新增静态边** ⇒ eager 文件数 +1 ⇒ 必报（棘轮只允许减少）', () => {
    const before = makeMeta('dynamic-import');
    const after = makeMeta('import-statement');

    // 动态边时 b 不计入 eager（2 文件）；改成静态后计入（3 文件）
    expect(summarizeEager(before, ENTRY).total).toBe(2);
    expect(summarizeEager(after, ENTRY).total).toBe(3);

    const comparison = compareStartupGraph(
      summarizeEager(after, ENTRY),
      baselineOf(before)
    );
    expect(comparison.problems.length).toBeGreaterThan(0);
    expect(comparison.problems.join('\n')).toContain('增加');
  });

  it('缩小 ⇒ 通过并提示下调基线锁定成果', () => {
    const big = makeMeta('import-statement');
    const small = makeMeta('dynamic-import');
    const comparison = compareStartupGraph(
      summarizeEager(small, ENTRY),
      baselineOf(big)
    );
    expect(comparison.problems).toEqual([]);
    expect(comparison.shrink).toContain('下调基线');
  });

  it('非法基线（缺 eager）⇒ 必报，不得静默通过', () => {
    const meta = makeMeta('import-statement');
    const comparison = compareStartupGraph(summarizeEager(meta, ENTRY), {
      version: 1,
      entry: ENTRY,
      byTopDir: {},
    } as StartupGraphBaseline);
    expect(comparison.problems.length).toBe(1);
    expect(comparison.problems[0]).toContain('非法基线');
  });

  it('入口不一致 ⇒ 必报（不同入口的图不可比）', () => {
    const meta = makeMeta('import-statement');
    const baseline = baselineOf(meta);
    baseline.entry = 'src/other-entry.ts';
    const comparison = compareStartupGraph(
      summarizeEager(meta, ENTRY),
      baseline
    );
    expect(comparison.problems.length).toBe(1);
    expect(comparison.problems[0]).toContain('入口不一致');
  });
});
