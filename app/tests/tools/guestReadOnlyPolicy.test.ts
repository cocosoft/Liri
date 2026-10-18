/**
 * A2-a：GuestReadOnlyPolicy 单元测试。
 *
 * 判定依据是 `TOOL_EFFECTS` 声明，不是工具名字符串：
 * ① owner/operator ⇒ 放行；
 * ② guest + sideEffect:'none'（file_read）⇒ 放行；
 * ③ guest + sideEffect:'external'（bash）⇒ 拒绝；
 * ④ guest + 未知工具（无效果声明）⇒ fail-closed 拒绝。
 */
import { describe, expect, it } from 'bun:test';
import { GuestReadOnlyPolicy } from '../../src/tools/policy/GuestReadOnlyPolicy.js';
import type { PolicyContext } from '../../src/tools/policy/ToolPolicy.js';
import type { Tool } from '../../src/tools/types/Tool.js';

const policy = new GuestReadOnlyPolicy();

function tool(name: string): Tool {
  return { name } as unknown as Tool;
}

describe('A2-a GuestReadOnlyPolicy', () => {
  it('owner / operator 放行（默认行为不变）', () => {
    for (const userRole of ['owner', 'operator'] as const) {
      const ctx: PolicyContext = { userRole };
      expect(policy.evaluate(tool('bash'), ctx).allowed).toBe(true);
      expect(policy.evaluate(tool('file_write'), ctx).allowed).toBe(true);
    }
  });

  it('guest：只读工具放行、有副作用工具拒绝', () => {
    const ctx: PolicyContext = { userRole: 'guest' };
    expect(policy.evaluate(tool('file_read'), ctx).allowed).toBe(true);
    expect(policy.evaluate(tool('glob'), ctx).allowed).toBe(true);
    expect(policy.evaluate(tool('bash'), ctx).allowed).toBe(false);
    expect(policy.evaluate(tool('file_write'), ctx).allowed).toBe(false);
    expect(policy.evaluate(tool('mcp_tool'), ctx).allowed).toBe(false);
  });

  it('guest + 未知工具 ⇒ fail-closed 拒绝', () => {
    const result = policy.evaluate(tool('unknown_plugin_tool'), {
      userRole: 'guest',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('无效果声明');
  });

  it('evaluateBatch 与逐条求值一致', () => {
    const ctx: PolicyContext = { userRole: 'guest' };
    const tools = [tool('file_read'), tool('bash')];
    const results = policy.evaluateBatch(tools, ctx);
    expect(results.map((r) => r.allowed)).toEqual([true, false]);
  });
});
