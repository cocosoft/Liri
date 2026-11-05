/**
 * P2-1（2026-11-05 真机 + 实时复现）：**「失败」不得被分类成「成功但无输出」**。
 *
 * 事故链：`ToolRegistry.executeTool` 的「工具不存在 / 策略拒绝」两个分支只写 `newMessages`，
 * `data/result` 为 null 且 **`error` 缺省** ⇒ `classifyToolResult` 判成 `empty-success`
 * ⇒ 模型收到的正文是「（工具执行成功，无输出）… 请勿重复调用」。
 *
 * 真机证据（`session_mw375o4312e5f31d38` 13:21:27Z）：模型把 `file_edit` 写成了 `edit_file`，
 * 同一批里 `file_edit` 真的改了文件，而 `edit_file` 的回执是「执行成功，无输出」——
 * 模型因此无从得知自己调错了工具名。
 *
 * 本用例锁：两条分支都必须落 `error`，且三态判定为 `error`（不是 `empty-success`）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ToolRegistry } from '../../src/tools/ToolRegistry.js';
import { resetDefaultToolPolicyPipelineForTest } from '../../src/tools/policy/defaultPipeline.js';
import { getEmptyToolUseContext } from '../../src/tools/types/ToolUseContext.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';
import type { Tool } from '../../src/tools/types/Tool.js';
import { createToolResult } from '../../src/tools/types/ToolResult.js';
import { classifyToolResult } from '../../src/chat/services/toolResultContract.js';

function fakeTool(name: string): Tool {
  return {
    name,
    execute: async () => createToolResult('ok'),
  } as unknown as Tool;
}

function ctxWith(
  policyContext?: NonNullable<ToolUseContext['policyContext']>
): ToolUseContext {
  return {
    ...getEmptyToolUseContext(),
    ...(policyContext ? { policyContext } : {}),
  } as ToolUseContext;
}

beforeEach(() => resetDefaultToolPolicyPipelineForTest());
afterEach(() => resetDefaultToolPolicyPipelineForTest());

describe('P2-1 工具不存在 ⇒ 失败可判定', () => {
  it('未注册的工具名（如真机误写的 edit_file）⇒ error 落字段，且分类为 error', async () => {
    const registry = new ToolRegistry();
    registry.registerTool(fakeTool('file_edit'));

    const result = await registry.executeTool(
      { toolName: 'edit_file', input: { file_path: 'a.ts' } },
      ctxWith()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('edit_file not found');
    // 修复前这里是 'empty-success'（模型被告知「执行成功，无输出」）
    expect(classifyToolResult(result)).toBe('error');
    // 模型侧仍拿到可执行原因
    const content = String(
      (result.newMessages as Array<{ content?: string }> | undefined)?.[0]
        ?.content
    );
    expect(content).toContain('Tool edit_file not found');
  });
});

describe('P2-1 策略拒绝 ⇒ 失败可判定', () => {
  it('guest 上下文拒绝 bash ⇒ error 落字段，且分类为 error', async () => {
    const registry = new ToolRegistry();
    registry.registerTool(fakeTool('bash'));

    const result = await registry.executeTool(
      { toolName: 'bash', input: {} },
      ctxWith({ userRole: 'guest' })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed by policy');
    expect(classifyToolResult(result)).toBe('error');
  });
});
