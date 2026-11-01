/**
 * R7：infra 层内环棘轮（2026-11-01）。
 *
 * 背景：`config ↔ error` 只是表象 —— 实测 infra 内部是一个 **15 模块的强连通分量**
 * （config/error/monitoring/constants/utils/… 互相可达）。本轮把 `error` 的出边清零
 * （日志改 kernel 门面、env 读取改注入）后降为 **14**，并用基线锁住成果。
 *
 * 本用例只测纯函数（SCC 求解 + 棘轮判定）；实仓结果由 `lint:infra` 的 R7 输出。
 */
import { describe, expect, it } from 'bun:test';
import {
  compareInfraCycles,
  findInfraCycleMembers,
} from '../../scripts/infraBoundaryCore';

describe('R7 层内环棘轮', () => {
  it('findInfraCycleMembers：两节点互指 ⇒ 都在环内；单向链 ⇒ 不在环内', () => {
    expect(
      findInfraCycleMembers(
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
          { from: 'c', to: 'd' },
        ],
        ['a', 'b', 'c', 'd']
      )
    ).toEqual(['a', 'b']);
  });

  it('三节点环全量命中；自环不计（from===to 忽略）', () => {
    expect(
      findInfraCycleMembers(
        [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'a' },
          { from: 'd', to: 'd' },
        ],
        ['a', 'b', 'c', 'd']
      )
    ).toEqual(['a', 'b', 'c']);
  });

  it('棘轮：新模块进入环 ⇒ 违规；成员离开环 ⇒ 仅提示可下调', () => {
    const baseline = { scc: ['a', 'b'] };

    const grew = compareInfraCycles(['a', 'b', 'c'], baseline);
    expect(grew.violations).toHaveLength(1);
    expect(grew.violations[0]).toContain('c');

    const shrank = compareInfraCycles(['a'], baseline);
    expect(shrank.violations).toHaveLength(0);
    expect(shrank.hints.join()).toContain('可下调基线');
  });

  it('缺基线 ⇒ fail-closed（不接受沉默通过）', () => {
    const report = compareInfraCycles(['a', 'b'], null);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain('缺少环基线');
  });
});
