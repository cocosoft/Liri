/**
 * 子代理工具集契约测试（多 agent 协作方案 O7）
 *
 * 锁定：
 * 1. **两段校验顺序** —— 先查"未知工具集"（拼错），再查"父级子集"（禁止扩权）；
 *    顺序颠倒会把拼错的名字误报为"越权"，给出误导性错误；
 * 2. **阻断清单** —— 父级持有也不可授予子代理；
 * 3. **fail-closed** —— 显式传入的空白名单**拒绝**（原语义会放开全部工具）；
 * 4. 大小写不敏感与黑名单语义。
 */
import { describe, test, expect } from 'bun:test';
import {
  DELEGATE_BLOCKED_TOOLS,
  validateToolsetRequest,
  type ToolsetContract,
} from '../../../src/tools/AgentTool/AgentToolsetContract';

/** 父级可见工具（含阻断清单里的 Agent / sessions_yield） */
const PARENT = ['Bash', 'Read', 'Write', 'WebFetch', 'Agent', 'Task', 'sessions_yield'];

function contract(over: Partial<ToolsetContract> = {}): ToolsetContract {
  return { parentToolNames: PARENT, ...over };
}

describe('validateToolsetRequest：正常路径', () => {
  test('未提供白/黑名单 ⇒ 通过（继承全部可继承工具）', () => {
    const result = validateToolsetRequest({ contract: contract() });

    expect(result.ok).toBe(true);
    expect(result.ok && result.allowed).toBeUndefined();
    expect(result.ok && result.denied).toEqual([]);
  });

  test('白名单为父级子集 ⇒ 通过，且归一为小写', () => {
    const result = validateToolsetRequest({
      allowedTools: ['bash', 'READ'],
      contract: contract(),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.allowed).toEqual(['bash', 'read']);
  });

  test('黑名单只需"存在"即可（缩小能力无需子集校验）', () => {
    const result = validateToolsetRequest({
      deniedTools: ['Write'],
      contract: contract(),
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.denied).toEqual(['write']);
  });
});

describe('validateToolsetRequest：两段校验（O7②）', () => {
  test('第①段 未知工具名（拼错）⇒ 拒绝，且**不改报为越权**', () => {
    const result = validateToolsetRequest({
      allowedTools: ['Bas'], // 拼错
      contract: contract(),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('未知工具名');
    expect(result.ok === false && result.error).not.toContain('禁止扩权');
  });

  test('第②段 名字存在但父级不具备 ⇒ 拒绝（禁止扩权）', () => {
    const result = validateToolsetRequest({
      allowedTools: ['SomeToolNotInParent', 'Bash'],
      contract: contract({ parentToolNames: ['Bash', 'Read'] }),
    });

    // 'SomeToolNotInParent' 不在已知表（父级 ∪ 阻断）⇒ 归第①段
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('未知工具名');
  });

  test('第②段 已知但被阻断 ⇒ 拒绝（父级有也不可授予）', () => {
    const result = validateToolsetRequest({
      allowedTools: ['Agent'],
      contract: contract(),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('禁止扩权');

    const yieldAttempt = validateToolsetRequest({
      allowedTools: ['sessions_yield'],
      contract: contract(),
    });
    expect(yieldAttempt.ok).toBe(false);
    expect(yieldAttempt.ok === false && yieldAttempt.error).toContain(
      '禁止扩权'
    );
  });

  test('第②段 父级未持有的普通工具 ⇒ 拒绝（禁止扩权）', () => {
    // 同时出现在"已知表"（由阻断清单贡献）与"父级不持有"两侧
    const result = validateToolsetRequest({
      allowedTools: ['Task'],
      contract: contract({ parentToolNames: ['Bash'] }),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('禁止扩权');
  });

  test('黑名单含未知工具名 ⇒ 拒绝（拼错不应被静默忽略）', () => {
    const result = validateToolsetRequest({
      deniedTools: ['Bassh'],
      contract: contract(),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('deniedTools');
  });
});

describe('validateToolsetRequest：fail-closed（O7③）', () => {
  test('显式空白名单 ⇒ 拒绝（原语义会放开全部工具）', () => {
    const result = validateToolsetRequest({
      allowedTools: [],
      contract: contract(),
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('空清单');
  });
});

describe('DELEGATE_BLOCKED_TOOLS：阻断清单内容', () => {
  test('含委派入口（Agent/Task）与 yield 工具', () => {
    expect(DELEGATE_BLOCKED_TOOLS).toContain('Agent');
    expect(DELEGATE_BLOCKED_TOOLS).toContain('Task');
    expect(DELEGATE_BLOCKED_TOOLS).toContain('sessions_yield');
  });
});
