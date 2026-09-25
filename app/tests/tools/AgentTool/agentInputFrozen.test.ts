/**
 * N-70（2026-09-25）：**只读工具入参不得导致整次工具调用失败**。
 *
 * 现象（线上实测）：`Agent` 工具在**入参携带字符串 `allowedTools`/`deniedTools`** 时
 * 报 `[execute] Attempted to assign to readonly property.`（`UNHANDLED_ERROR`）；
 * 精确对照 —— 3 个并发调用全传字符串 ⇒ 3 次报错，单次调用未传 ⇒ 0 次报错。
 *
 * 根因：`executeGuard` 的归一逻辑**直接对调用方传入的入参对象赋值**
 * （`agentInput.allowedTools = …`），而该入参在部分路径下是**只读**的。
 *
 * 修复：入参一律以**浅拷贝**承载归一结果，**不再写调用方对象**（工具本就不应改写入参）。
 * 两条用例均为"修复前必失败"型。
 */
import { describe, test, expect } from 'bun:test';
import { createAgentTool } from '../../../src/tools/AgentTool/AgentTool';

const CTX = {} as never;

describe('N-70 只读入参（Agent 工具）', () => {
  test('冻结入参 + 字符串 allowedTools ⇒ 不抛 readonly（修复前必失败）', async () => {
    const tool = createAgentTool();
    const frozen = Object.freeze({
      description: '内部测试',
      prompt: '只回报数字 0',
      allowedTools: 'glob,grep',
      deniedTools: 'bash',
    });

    let thrown: unknown = null;
    try {
      await tool.execute(frozen as never, CTX);
    } catch (err) {
      thrown = err;
    }

    const text =
      thrown instanceof Error ? thrown.message : String(thrown ?? '');
    // 修复前：TypeError: Attempted to assign to readonly property.
    expect(text).not.toContain('readonly');
    expect(text).not.toContain('Attempted to assign');
  });

  test('未冻结入参也**不被写回**（工具不应改写入参）', async () => {
    const tool = createAgentTool();
    const input: Record<string, unknown> = {
      description: '内部测试',
      prompt: '只回报数字 0',
      allowedTools: 'glob,grep',
    };

    await tool.execute(input as never, CTX).catch(() => undefined);

    // 修复前：`allowedTools` 被就地替换为数组（['glob','grep']）⇒ 本条必失败
    expect(input.allowedTools).toBe('glob,grep');
  });
});
