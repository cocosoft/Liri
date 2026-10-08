// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 13-P0-2（2026-10-05）：验收标准结构化（`SuccessCriteria`）守卫。
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A2 —— `acceptanceCriteria` 是自由文本，
 * 只进 Reviewer prompt，**未注入验证器** ⇒ 验证器 checks[] 由 LLM 自由发明，
 * 「你写的验收标准 ≠ 实际判定用的标准」。
 */
import { describe, it, expect } from 'bun:test';
import {
  parseSuccessCriteria,
  renderCriteriaSkeleton,
  alignChecksToCriteria,
  findUnprovableCriteria,
} from '../../src/core/successCriteria.js';
import { VerifierAgent } from '../../src/query/VerifierAgent.js';
import type { VerificationInput } from '../../src/query/VerifierAgent.js';

describe('parseSuccessCriteria（自由文本 → 结构化）', () => {
  it('按换行/分号切分并剥离列表标记', () => {
    const c = parseSuccessCriteria('- 构建通过\n2) 测试全绿；* 无回归');
    expect(c?.items.map((i) => i.desc)).toEqual([
      '构建通过',
      '测试全绿',
      '无回归',
    ]);
    expect(c?.items.map((i) => i.id)).toEqual(['c1', 'c2', 'c3']);
    expect(c?.items.every((i) => i.check === 'llm')).toBe(true);
  });

  it('空/纯空白 ⇒ undefined（保持旧路径）', () => {
    expect(parseSuccessCriteria(undefined)).toBeUndefined();
    expect(parseSuccessCriteria('   ')).toBeUndefined();
    expect(parseSuccessCriteria('\n\n')).toBeUndefined();
  });
});

describe('renderCriteriaSkeleton', () => {
  it('按序渲染条目并声明唯一检查项集合', () => {
    const c = parseSuccessCriteria('甲\n乙')!;
    const text = renderCriteriaSkeleton(c);
    expect(text).toContain('c1. 甲');
    expect(text).toContain('c2. 乙');
    expect(text).toContain('禁止增删');
  });
});

/**
 * 2026-10-08（方案1 全面修复）：验收标准**可证性**黑名单守卫。
 *
 * 真机实测（轮 8）planner 会写出「UTF-8 无 BOM 且严格 6 字节」「必须调用 glob 精确匹配」
 * 「可写性须显式写入测试」等**原理上无法证明**的条件 ⇒ 验证器骨架「无法判定 ⇒ false」⇒
 * 该条恒 false ⇒ checkPassRate 偏低 ⇒ REJECT（长程任务不收敛）。
 * 本守卫锁住：**明确不可证的措辞必被命中**，**可证的正例不得被误伤**（保守性）。
 */
describe('findUnprovableCriteria（可证性黑名单）', () => {
  it('命中：字节级/编码级/校验和/元数据/可写性/前后对比/指定工具动作/以 shell 判定', () => {
    const bad = [
      '文件严格 6 字节且 UTF-8 无 BOM',
      '内容的 sha256 等于 ...',
      '文件无多余换行或空格',
      '目录权限位为 755',
      '目录可写性需显式写入测试证明',
      '与执行前后对比无差异',
      '必须调用 glob 以该路径精确匹配',
      // 2026-10-08 轮 10 真机实证：shell 受安全策略门控 ⇒ 不得作为判定动作
      'bash 执行只读命令 dir "C:\\tmp" 的输出中包含 sbx',
      '格式：powershell 运行 Get-Content 的输出非空',
    ];
    for (const c of bad) {
      expect({ c, hit: findUnprovableCriteria([c]).length }).toEqual({
        c,
        hit: 1,
      });
    }
  });

  it('不误伤：可证的正例一律放行（空数组 = 全部可证）', () => {
    const good = [
      'file_read 读取 C:\\tmp\\a.txt 返回内容等于 hello',
      'glob 在 C:\\tmp 下能列出 a.txt',
      'grep 在 a.txt 中命中文本 hello',
      '文件 C:\\tmp\\a.txt 存在',
    ];
    expect(findUnprovableCriteria(good)).toEqual([]);
  });

  it('返回的是**原文条目**（供纠正提示词逐条回喂）', () => {
    const items = ['正常条件', '文件严格 12 字节'];
    expect(findUnprovableCriteria(items)).toEqual(['文件严格 12 字节']);
  });
});

describe('alignChecksToCriteria（判定骨架对齐）', () => {
  const criteria = parseSuccessCriteria('甲\n乙\n丙')!;

  it('未注入 criteria ⇒ 原样返回（零行为变化）', () => {
    const checks = [{ item: 'x', passed: true }];
    expect(alignChecksToCriteria(checks, undefined)).toEqual(checks);
  });

  it('同名/包含匹配 ⇒ 按 criteria 顺序重排，item 用 criteria 描述', () => {
    const aligned = alignChecksToCriteria(
      [
        { item: '乙是否满足', passed: false },
        { item: '甲', passed: true },
        { item: '丙', passed: true },
      ],
      criteria
    );
    expect(aligned.map((c) => c.item)).toEqual(['甲', '乙', '丙']);
    expect(aligned.map((c) => c.passed)).toEqual([true, false, true]);
  });

  it('漏项 ⇒ passed:false（漏项不复行）；骨架外项丢弃', () => {
    const aligned = alignChecksToCriteria(
      [
        { item: '甲', passed: true },
        { item: '模型自己发明的检查项', passed: true },
      ],
      criteria
    );
    expect(aligned).toHaveLength(3);
    expect(aligned.map((c) => c.passed)).toEqual([true, false, false]);
  });

  it('空 checks ⇒ 全条目 passed:false（不可空集假绿）', () => {
    const aligned = alignChecksToCriteria([], criteria);
    expect(aligned).toHaveLength(3);
    expect(aligned.every((c) => !c.passed)).toBe(true);
  });

  // R07-5 补强（2026-10-07）：以下两条为原有用例**未覆盖**的属性
  it('同一返回项不被两条验收项重复消费（`pool.splice` 逐项移除）', () => {
    // 两条验收项文本相同时，只有第一条能消费该返回项 ⇒ 第二条必须 passed:false
    const dup = parseSuccessCriteria('甲\n甲')!;
    const aligned = alignChecksToCriteria([{ item: '甲', passed: true }], dup);
    expect(aligned.map((c) => c.passed)).toEqual([true, false]);
  });

  it('包含匹配为**双向宽松**对齐（锁定现状，防无意收紧/放宽）', () => {
    // 返回项包含验收描述 ⇒ 命中
    const c1 = parseSuccessCriteria('测试通过')!;
    expect(
      alignChecksToCriteria([{ item: '确认测试通过了吗', passed: true }], c1)
    ).toEqual([{ item: '测试通过', passed: true }]);
    // 验收描述包含返回项 ⇒ 亦命中（故意宽松；**非**精确匹配）
    const c2 = parseSuccessCriteria('测试通过且无回归')!;
    expect(
      alignChecksToCriteria([{ item: '测试通过', passed: false }], c2)
    ).toEqual([{ item: '测试通过且无回归', passed: false }]);
  });
});

describe('VerifierAgent × successCriteria（端到端）', () => {
  const input: VerificationInput = {
    messages: [{ role: 'user', content: 'do it' }],
    toolResults: [{ toolName: 'file_write', toolCallId: 't1', result: 'ok' }],
    turnCount: 1,
    sessionId: 's_criteria',
    successCriteria: parseSuccessCriteria('甲\n乙\n丙'),
  };

  it('模型少报一项 ⇒ checks 被补齐为骨架长度，且不放行', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    agent.setCallModel(async function* () {
      yield {
        content: JSON.stringify({
          verdict: 'APPROVE',
          confidence: 0.9,
          checks: [
            { item: '甲', passed: true },
            { item: '乙', passed: true },
          ],
        }),
      };
    });
    const r = await agent.verify(input, new AbortController().signal);
    expect(r.checks?.map((c) => c.item)).toEqual(['甲', '乙', '丙']);
    expect(r.checks?.map((c) => c.passed)).toEqual([true, true, false]);
    // checkPassRate = 2/3（非 APPROVE 区间）⇒ 不放行
    expect(r.passed).toBe(false);
  });

  it('未注入 criteria ⇒ 保持模型返回的 checks（旧路径）', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    agent.setCallModel(async function* () {
      yield {
        content: JSON.stringify({
          verdict: 'APPROVE',
          confidence: 0.9,
          checks: [{ item: '自由项', passed: true }],
        }),
      };
    });
    const r = await agent.verify(
      { ...input, successCriteria: undefined },
      new AbortController().signal
    );
    expect(r.checks).toEqual([{ item: '自由项', passed: true }]);
  });

  // R07-5 补强（2026-10-07）：骨架存在时**单指标路径不可绕过**
  it('骨架存在且模型未给 checks 字段 ⇒ 全项 false ⇒ 即使 APPROVE/0.95 也不放行', async () => {
    const agent = new VerifierAgent({ failClosed: true });
    agent.setCallModel(async function* () {
      yield {
        content: JSON.stringify({ verdict: 'APPROVE', confidence: 0.95 }),
      };
    });
    const r = await agent.verify(input, new AbortController().signal);
    expect(r.checks?.map((c) => c.item)).toEqual(['甲', '乙', '丙']);
    expect(r.checks?.every((c) => !c.passed)).toBe(true);
    // checkPassRate = 0 ⇒ 直接 REJECT（**不会**因 checks 缺失退回单指标按 verdict 放行）
    expect(r.passed).toBe(false);
  });
});
