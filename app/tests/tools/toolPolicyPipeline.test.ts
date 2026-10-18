/**
 * 工具策略管道（ToolPolicyPipeline）阶段编排测试
 *
 * 覆盖：
 * ① `addStage` 追加到末尾（求值顺序 = 添加顺序）；
 * ② `insertStage` 指定位置插入（越界按 JS splice 语义夹取）；
 * ③ `removeStage` **真的移除**（命中返回 true、长度减一、剩余阶段顺序不变、重复名只删首个）；
 * ④ `removeStage` 未命中返回 false 且**不改动**阶段列表；
 * ⑤ `clearStages` 清空；
 * ⑥ 端到端：移除后 `evaluate` 不再受该阶段影响（拒绝阶段被移除 ⇒ 放行）。
 *
 * 负向夹具自证：`removeStage` 若退化为「假移除」（如误用 `splice(index, 0)`），
 * ③⑤⑥ 会立刻红灯 —— 门禁非恒真。
 */
import { describe, expect, it } from 'bun:test';

import { ToolPolicyPipeline } from '../../src/tools/policy/ToolPolicyPipeline';
import type {
  PolicyContext,
  PolicyResult,
  ToolPolicy,
} from '../../src/tools/policy/ToolPolicy';
import { allowResult, denyResult } from '../../src/tools/policy/ToolPolicy';
import type { Tool } from '../../src/tools/types/Tool';

const CTX: PolicyContext = { userId: 'test-user', userRole: 'owner' };

/** 最小假工具：策略求值只读 `tool.name` */
function fakeTool(name: string): Tool {
  return { name } as unknown as Tool;
}

/** 可配置的假策略：记录自身求值次数，便于验证顺序与移除效果 */
class FakePolicy implements ToolPolicy {
  calls = 0;

  constructor(
    readonly name: string,
    private readonly verdict: 'allow' | 'deny' = 'allow'
  ) {}

  evaluate(_tool: Tool, _context: PolicyContext): PolicyResult {
    this.calls += 1;
    return this.verdict === 'allow'
      ? allowResult(this.name)
      : denyResult(this.name, '被测试策略拒绝');
  }

  evaluateBatch(tools: Tool[], context: PolicyContext): PolicyResult[] {
    return tools.map((t) => this.evaluate(t, context));
  }
}

const names = (pipeline: ToolPolicyPipeline): string[] =>
  pipeline.getStages().map((s) => s.name);

describe('ToolPolicyPipeline 阶段编排', () => {
  it('空管道 ⇒ 默认拒绝（fail-closed）', () => {
    const pipeline = new ToolPolicyPipeline();
    expect(pipeline.getStages()).toEqual([]);
    const result = pipeline.evaluate(fakeTool('x'), CTX);
    expect(result.allowed).toBe(false);
    expect(result.policyName).toBe('ToolPolicyPipeline');
    expect(result.reason).toContain('no policy stages');
  });

  it('空管道 + allowEmpty:true ⇒ 显式放行', () => {
    const pipeline = new ToolPolicyPipeline(undefined, { allowEmpty: true });
    expect(pipeline.evaluate(fakeTool('x'), CTX).allowed).toBe(true);
    expect(pipeline.evaluateBatch([fakeTool('x')], CTX)[0]?.allowed).toBe(true);
  });

  it('构造入参被复制：外部数组后续改动不影响管道', () => {
    const a = new FakePolicy('A');
    const source = [a];
    const pipeline = new ToolPolicyPipeline(source);
    source.push(new FakePolicy('B'));
    expect(names(pipeline)).toEqual(['A']);
  });

  it('addStage：追加到末尾并返回 this（可链式）', () => {
    const pipeline = new ToolPolicyPipeline();
    const ret = pipeline
      .addStage(new FakePolicy('A'))
      .addStage(new FakePolicy('B'))
      .addStage(new FakePolicy('C'));
    expect(ret).toBe(pipeline);
    expect(names(pipeline)).toEqual(['A', 'B', 'C']);
  });

  it('insertStage：插入到指定位置，顺序随之变化', () => {
    const pipeline = new ToolPolicyPipeline([
      new FakePolicy('A'),
      new FakePolicy('C'),
    ]);
    pipeline.insertStage(1, new FakePolicy('B'));
    expect(names(pipeline)).toEqual(['A', 'B', 'C']);

    pipeline.insertStage(0, new FakePolicy('HEAD'));
    expect(names(pipeline)).toEqual(['HEAD', 'A', 'B', 'C']);
  });

  it('removeStage：命中 ⇒ 真正从列表移除（长度减一、其余顺序不变）', () => {
    const pipeline = new ToolPolicyPipeline([
      new FakePolicy('A'),
      new FakePolicy('B'),
      new FakePolicy('C'),
    ]);

    expect(pipeline.removeStage('B')).toBe(true);
    expect(names(pipeline)).toEqual(['A', 'C']);
  });

  it('removeStage：移除末尾阶段后长度确实减少（防 splice 参数写错导致的假移除）', () => {
    const pipeline = new ToolPolicyPipeline([
      new FakePolicy('A'),
      new FakePolicy('B'),
    ]);

    expect(pipeline.removeStage('B')).toBe(true);
    expect(pipeline.getStages()).toHaveLength(1);
    expect(names(pipeline)).toEqual(['A']);
  });

  it('removeStage：同名多次 ⇒ 只删首个，第二次仍返回 true', () => {
    const pipeline = new ToolPolicyPipeline([
      new FakePolicy('DUP'),
      new FakePolicy('X'),
      new FakePolicy('DUP'),
    ]);

    expect(pipeline.removeStage('DUP')).toBe(true);
    expect(names(pipeline)).toEqual(['X', 'DUP']);

    expect(pipeline.removeStage('DUP')).toBe(true);
    expect(names(pipeline)).toEqual(['X']);
  });

  it('removeStage：未命中 ⇒ false 且列表不变', () => {
    const pipeline = new ToolPolicyPipeline([new FakePolicy('A')]);
    expect(pipeline.removeStage('NOT_EXIST')).toBe(false);
    expect(names(pipeline)).toEqual(['A']);
  });

  it('clearStages：清空并返回 this（清空后 fail-closed）', () => {
    const pipeline = new ToolPolicyPipeline([
      new FakePolicy('A'),
      new FakePolicy('B'),
    ]);
    const ret = pipeline.clearStages();
    expect(ret).toBe(pipeline);
    expect(pipeline.getStages()).toEqual([]);
    expect(pipeline.evaluate(fakeTool('x'), CTX).allowed).toBe(false);
  });

  it('getStages：返回副本，外部改动不污染内部状态', () => {
    const pipeline = new ToolPolicyPipeline([new FakePolicy('A')]);
    const snapshot = pipeline.getStages() as ToolPolicy[];
    snapshot.push(new FakePolicy('B'));
    expect(names(pipeline)).toEqual(['A']);
  });
});

describe('ToolPolicyPipeline 求值语义', () => {
  it('按阶段顺序求值，首个拒绝即短路', () => {
    const a = new FakePolicy('A', 'allow');
    const b = new FakePolicy('B', 'deny');
    const c = new FakePolicy('C', 'allow');
    const pipeline = new ToolPolicyPipeline([a, b, c]);

    const result = pipeline.evaluate(fakeTool('demo'), CTX);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('B');
    expect(result.reason).toContain('demo');
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
    expect(c.calls).toBe(0);
  });

  it('移除拒绝阶段后成为放行（端到端验证「真移除」的行为效果）', () => {
    const deny = new FakePolicy('Blocker', 'deny');
    const allow = new FakePolicy('Pass', 'allow');
    const pipeline = new ToolPolicyPipeline([deny, allow]);

    expect(pipeline.evaluate(fakeTool('demo'), CTX).allowed).toBe(false);

    expect(pipeline.removeStage('Blocker')).toBe(true);

    const after = pipeline.evaluate(fakeTool('demo'), CTX);
    expect(after.allowed).toBe(true);
    expect(deny.calls).toBe(1); // 移除后不再被调用
    // 首次求值在 Blocker 处短路 ⇒ allow 未被调用；移除后才是第 1 次
    expect(allow.calls).toBe(1);
  });

  it('evaluateBatch：逐工具求值，拒绝项带阶段名原因', () => {
    const pipeline = new ToolPolicyPipeline([
      new FakePolicy('Blocker', 'deny'),
    ]);
    const results = pipeline.evaluateBatch(
      [fakeTool('t1'), fakeTool('t2')],
      CTX
    );

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('Blocker');
    }
  });
});
