// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 并行批次收尾辅助特征化（P3-2，2026-11-16）
//
// `runSwarmPath` 的收尾段（目标文案 / 失败归因 / 汇总格式 / 进度文案）原为内联表达式，
// 判错只表现为「文案错 / 某项恒 0」（不报错）⇒ 外移后逐条钉住可见输出。
import { describe, expect, it } from 'bun:test';
import {
  buildGatedAggregatedOutput,
  buildLegacyAggregatedOutput,
  buildSwarmFailureReason,
  deriveSwarmObjective,
  formatSwarmProgressMessage,
} from '@openliri/tool-agent/AgentTool/swarmPath';

const task = (id: string, description: string) => ({
  id,
  description,
  prompt: description,
  subagent_type: 'general' as const,
});

/** 门禁汇总所需的最小 worker 形状（补齐 `SwarmWorkerResult` 的必填字段） */
const worker = (
  id: string,
  success: boolean,
  verify: 'passed' | 'failed' | 'skipped'
) => ({
  id,
  success,
  verify,
  description: id,
  output: '',
  timedOut: false,
  ok: success,
});

describe('deriveSwarmObjective', () => {
  it('agentInput.description 非空 ⇒ 原样使用', () => {
    expect(
      deriveSwarmObjective({ description: '  目标 A  ' }, [
        task('t1', '不应被使用'),
      ])
    ).toBe('目标 A');
  });

  it('description 为空 ⇒ 拼接任务描述（中文分号），过滤空白项', () => {
    expect(
      deriveSwarmObjective({ description: '  ' }, [
        task('t1', ' 一 '),
        task('t2', '   '),
        task('t3', '二'),
      ])
    ).toBe('一；二');
  });

  it('拼接结果超过 200 字 ⇒ 截断到 200', () => {
    const long = 'x'.repeat(150);
    const result = deriveSwarmObjective({ description: '' }, [
      task('t1', long),
      task('t2', long),
    ]);
    expect(result).toHaveLength(200);
  });

  it('两处皆空 ⇒ 占位文案', () => {
    expect(deriveSwarmObjective({ description: '' }, [task('t1', '')])).toBe(
      '(swarm batch)'
    );
  });
});

describe('buildSwarmFailureReason', () => {
  const base = {
    batchOk: false,
    failedCount: 0,
    workerCount: 3,
    cancelledCount: 0,
    cancelledFact: false,
    gateIncomplete: false,
    verifySkipped: 0,
    okCount: 3,
    totalTasks: 3,
  };

  it('批次通过 ⇒ undefined', () => {
    expect(buildSwarmFailureReason({ ...base, batchOk: true })).toBeUndefined();
  });

  it('无任何逐项原因 ⇒ 兜底文案（带完成数）', () => {
    expect(buildSwarmFailureReason({ ...base, okCount: 2 })).toBe(
      '批次未通过（完成 2/3）'
    );
  });

  it('worker 未通过 / 投递缺口 / 门禁未完成 ⇒ 逐项罗列，互不遮蔽', () => {
    expect(
      buildSwarmFailureReason({
        ...base,
        failedCount: 2,
        cancelledCount: 1,
        gateIncomplete: true,
        verifySkipped: 1,
      })
    ).toBe(
      '2/3 个 worker 未通过；1 个任务未投递（批次被取消）；门禁未完成（1 个 worker 未获门禁结论）'
    );
  });

  it('投递缺口为 0 但取消事实为真 ⇒ 单独成句（收尾阶段中止）', () => {
    expect(buildSwarmFailureReason({ ...base, cancelledFact: true })).toBe(
      '批次被取消（任务已全部投递，中止发生在收尾阶段）'
    );
  });

  it('缺口与取消事实同时存在 ⇒ 只出缺口句（不重复）', () => {
    expect(
      buildSwarmFailureReason({
        ...base,
        cancelledCount: 2,
        cancelledFact: true,
      })
    ).toBe('2 个任务未投递（批次被取消）');
  });
});

describe('buildLegacyAggregatedOutput', () => {
  it('按任务顺序输出，未产出 worker 如实标注', () => {
    const out = buildLegacyAggregatedOutput({
      swarmTasks: [task('t1', '一号'), task('t2', '二号'), task('t3', '三号')],
      workerById: new Map([
        ['t1', { id: 't1', success: true }],
        ['t2', { id: 't2', success: false, feedback: 'boom' }],
      ]),
      summaryTextByWorkerId: new Map([['t1', '结果一']]),
    });
    expect(out.split('\n---\n')).toEqual([
      '[OK] 一号: 结果一',
      '[FAIL] 二号: boom',
      '[FAIL] 三号: 未执行（批次取消或未投递）',
    ]);
  });

  it('失败且无 feedback ⇒ 兜底文案；成功但无摘要 ⇒ 空串', () => {
    const out = buildLegacyAggregatedOutput({
      swarmTasks: [task('t1', '一号'), task('t2', '二号')],
      workerById: new Map([
        ['t1', { id: 't1', success: false }],
        ['t2', { id: 't2', success: true }],
      ]),
      summaryTextByWorkerId: new Map(),
    });
    expect(out.split('\n---\n')).toEqual([
      '[FAIL] 一号: 执行失败',
      '[OK] 二号: ',
    ]);
  });
});

describe('buildGatedAggregatedOutput', () => {
  const workers = [worker('w1', true, 'passed'), worker('w2', false, 'failed')];

  it('无合成结果 ⇒ 首段被过滤，仅保留门禁头与 worker 行', () => {
    const out = buildGatedAggregatedOutput({
      allPassed: false,
      verifyPassed: 1,
      verifyFailed: 1,
      verifySkipped: 0,
      workers,
      summaryTextByWorkerId: new Map([['w1', '甲']]),
    });
    expect(out.split('\n\n')).toEqual([
      '## Worker 结果（门禁：passed 1 / failed 1 / skipped 0；allPassed: false）',
      '[OK] w1: 甲',
      '[FAIL 未过门禁] w2: ',
    ]);
  });

  it('有合成结果 ⇒ 作为首段前置', () => {
    const out = buildGatedAggregatedOutput({
      synthesized: '综合结论',
      allPassed: true,
      verifyPassed: 1,
      verifyFailed: 0,
      verifySkipped: 0,
      workers: [workers[0]!],
      summaryTextByWorkerId: new Map(),
    });
    expect(out.startsWith('## 合成结果\n综合结论\n\n## Worker 结果')).toBe(
      true
    );
  });
});

describe('formatSwarmProgressMessage', () => {
  const base = {
    okCount: 2,
    workerCount: 3,
    cancelledCount: 0,
    cancelledFact: false,
    gated: false,
    allPassed: false,
  };

  it('基础文案：完成数 / 总数', () => {
    expect(formatSwarmProgressMessage(base)).toBe(
      'Parallel execution completed: 2/3 tasks succeeded'
    );
  });

  it('投递缺口 > 0 ⇒ 追加已取消句', () => {
    expect(formatSwarmProgressMessage({ ...base, cancelledCount: 1 })).toBe(
      'Parallel execution completed: 2/3 tasks succeeded（已取消：1 个任务未投递）'
    );
  });

  it('缺口为 0 但取消事实为真 ⇒ 追加收尾阶段中止句', () => {
    expect(formatSwarmProgressMessage({ ...base, cancelledFact: true })).toBe(
      'Parallel execution completed: 2/3 tasks succeeded（批次被取消：任务已全部投递，收尾阶段中止）'
    );
  });

  it('开合成/门禁 ⇒ 追加 allPassed', () => {
    expect(
      formatSwarmProgressMessage({ ...base, gated: true, allPassed: true })
    ).toBe(
      'Parallel execution completed: 2/3 tasks succeeded（allPassed: true）'
    );
  });
});
