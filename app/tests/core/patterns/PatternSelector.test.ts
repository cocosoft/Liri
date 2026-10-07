import { describe, expect, test } from 'bun:test';
import {
  selectPattern,
  listPatterns,
  getPatternDescriptor,
  validatePatterns,
  PATTERN_SELECTION_RULES,
  isPatternReachable,
  patternFeatureFlag,
  patternUnreachableReason,
} from '@modules/core/patterns/index.js';

describe('PatternSelector（Teamwork P2a）', () => {
  test('simple 复杂度 → null（回退现状快速路径，验收 #4 语义）', () => {
    expect(selectPattern({ complexity: 'simple' })).toBeNull();
    expect(selectPattern({ complexity: 'simple', research: true })).toBeNull();
  });

  test('complex + 研究型标志 → competitive_strategy（与 P0-3 门控同信号）', () => {
    const sel = selectPattern({ complexity: 'complex', research: true });
    expect(sel?.name).toBe('competitive_strategy');
  });

  // D4（2026-10-04，pattern-trigger-surfaces.md §5 裁定 A）：complex 非研究**不再**返回
  // long_task_pdl —— 其描述层声明 matches=simple、运行时由快速路径策略独立驱动
  // ⇒ 选择层如实返回 null（§1.5 选择层↔描述层不一致已消除）。
  test('complex 非研究 → null（不再假称 long_task_pdl）', () => {
    expect(selectPattern({ complexity: 'complex' })).toBeNull();
  });

  // D2：三个未接线 pattern 的 matches 不得再含悬空 `taskType`（本仓无 write/execute/verify 生产者）
  test('D2：三个未接线 pattern 的 matches 已去悬空 taskType', () => {
    for (const name of [
      'iterative_refine',
      'parallel_distributed',
      'self_verify',
    ] as const) {
      const d = getPatternDescriptor(name);
      expect(d).toBeDefined();
      const matches = (d?.matches ?? {}) as Record<string, unknown>;
      expect(matches.taskType).toBeUndefined();
      expect(Object.keys(matches).sort()).toEqual(['complexity']);
    }
  });

  // A8（2026-10-01）：选择结果必须携带可消费的装配描述——原仅 {name}，消费方无从决策
  test('A8：选择结果携带 descriptor 与其 assembly（消费方可直接读 assembler）', () => {
    const sel = selectPattern({ complexity: 'complex', research: true });
    expect(sel?.descriptor.name).toBe('competitive_strategy');
    expect(sel?.descriptor.assembly.assembler).toBe('competitive_strategy');
    expect(sel?.descriptor.assembly.bindings.length).toBeGreaterThan(0);

    // long_task_pdl 不再由 selectPattern 产出（D4）⇒ 直接取描述断言其装配入口
    const pdl = getPatternDescriptor('long_task_pdl');
    expect(pdl?.assembly.assembler).toBe('long_task_pdl');
  });
});

/**
 * 可达性（2026-10-07，`.trae/specs/pattern-catalog-reachability-and-persistence.md`）
 *
 * 修复背景：选择层原为**命令式 if** ⇒ 无处声明"哪些模式有触发面"，展示层只能另判或撒谎
 * （`self_verify` 装配 ready 却永不产出）。现由 `PATTERN_SELECTION_RULES` **派生**，
 * 且与 `selectPattern` **同源**（本组用例即断言该同源关系）。
 */
describe('PatternSelector 可达性（2026-10-07）', () => {
  test('触发规则表：当前唯一规则 = competitive_strategy（complex + research + 门控）', () => {
    expect(PATTERN_SELECTION_RULES.map((r) => r.name)).toEqual([
      'competitive_strategy',
    ]);
    expect(PATTERN_SELECTION_RULES[0].feature).toBe('COMPETITIVE_STRATEGY');
  });

  test('可达 ⇔ 选择层能产出（派生自规则表，不另建第二张表）', () => {
    const specs = [
      { complexity: 'simple' as const },
      { complexity: 'simple' as const, research: true },
      { complexity: 'complex' as const },
      { complexity: 'complex' as const, research: true },
    ];
    for (const p of listPatterns()) {
      const producible = specs.some((s) => selectPattern(s)?.name === p.name);
      expect(isPatternReachable(p.name)).toBe(producible);
    }
  });

  test('无触发面者必有原因（与可达性互补，`self_verify` 亦不例外）', () => {
    for (const p of listPatterns()) {
      const reason = patternUnreachableReason(p.name);
      if (isPatternReachable(p.name)) {
        expect(reason).toBeUndefined();
      } else {
        expect((reason ?? '').length).toBeGreaterThan(0);
      }
    }
    expect(patternUnreachableReason('self_verify')).toBeDefined();
  });

  test('门控声明单点：仅 competitive_strategy 带门控', () => {
    expect(patternFeatureFlag('competitive_strategy')).toBe(
      'COMPETITIVE_STRATEGY'
    );
    for (const n of [
      'iterative_refine',
      'parallel_distributed',
      'long_task_pdl',
      'self_verify',
    ] as const) {
      expect(patternFeatureFlag(n)).toBeUndefined();
    }
  });
});

describe('PatternRegistry（描述层）', () => {
  test('首批 5 个 pattern 已注册且描述字段齐全', () => {
    const patterns = listPatterns();
    expect(patterns).toHaveLength(5);
    for (const p of patterns) {
      expect(p.name).toBeTruthy();
      expect(p.displayName).toBeTruthy();
      expect(p.when).toBeTruthy();
      expect(p.roles.length).toBeGreaterThan(0);
      expect(p.assembly.assembler).toBeTruthy();
      expect(p.assembly.bindings.length).toBeGreaterThan(0);
    }
  });

  test('getPatternDescriptor 按名可取、未知名返回 undefined', () => {
    expect(getPatternDescriptor('long_task_pdl')?.displayName).toContain('PDL');
    expect(getPatternDescriptor('competitive_strategy')?.roles).toContain(
      'adversarial-reviewer'
    );
    expect(getPatternDescriptor('not_exist' as never)).toBeUndefined();
  });
});

// A8（2026-10-01）：装配描述契约 —— 原 composedOf 为自由文本，无法被程序校验/消费
describe('PatternAssembly（装配契约，A8）', () => {
  test('注册表自检通过（roles ↔ bindings 双向一一对应、providers 非空、assembler 一一对应）', () => {
    expect(validatePatterns()).toEqual([]);
  });

  test('每个 pattern 的 roles 与 bindings 角色集合完全一致', () => {
    for (const p of listPatterns()) {
      const boundRoles = p.assembly.bindings.map((b) => b.role).sort();
      expect(boundRoles).toEqual([...p.roles].sort());
    }
  });

  test('装配入口与模式名同域（当前一个模式对应一个装配入口）', () => {
    for (const p of listPatterns()) {
      expect(p.assembly.assembler).toBe(p.name);
    }
  });

  test('bindings 的承担方覆盖真实既有模块（PDL 由 plan_driven_loop 承接）', () => {
    const pdl = getPatternDescriptor('long_task_pdl');
    const providers = pdl?.assembly.bindings.flatMap((b) => b.providers) ?? [];
    expect(providers).toContain('plan_driven_loop');
    expect(providers).toContain('task_decomposer');
  });
});
