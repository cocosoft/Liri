/**
 * FIX-12（2026-10-27）：`session_lookup` 的注入**必须在任务裁剪之后**。
 *
 * 真机背景：`session_lookup` 未登记 `TOOL_CATEGORIES`（落 `misc`），而旧实现把它
 * `push` 进 `toolDefinitions` 后立刻被 `filterToolsByTask` 裁掉 —— 上下文提示词却
 * 仍告诉模型「可调用 session_lookup 取回原始记录」⇒ 模型看到的工具列表里没有它。
 * 08:59:49 的「工具未登记类别 ⇒ 落 misc ⇒ 被静默裁剪」告警即此路径。
 *
 * 本用例断言三点：① 裁剪仍生效（`computer_use` 被移除）；② 取回工具在最终工具面里；
 * ③ 未发生切窗时不注入。
 */
import { describe, expect, it } from 'bun:test';
import { createTestHost, createTestLlmStream } from './helpers';
import { runStreamMessage } from '../../../src/chat/orchestrator/streamMessageFlow.js';

const LOOKUP_TOOL = {
  name: 'session_lookup',
  description: '按事件区间取回被切早期原文',
  parameters: { type: 'object', properties: {} },
};

const SCHEMAS = [
  {
    name: 'file_read',
    description: '读文件',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'computer_use',
    description: '桌面自动化',
    parameters: { type: 'object', properties: {} },
  },
];

/** 跑一轮流式并返回**实际发给 provider 的工具名** */
async function runAndCaptureTools(windowed: boolean): Promise<string[]> {
  let names: string[] = [];
  const host = createTestHost({
    llmChunks: [{ content: 'ok' }],
    getToolRegistry: () => ({ getToolSchemas: () => SCHEMAS }) as never,
  });
  const patched = host as unknown as Record<string, unknown>;
  patched.recordToolsSnapshot = () => {};
  patched.isLastStreamBuildWindowed = () => windowed;
  patched.getSessionLookupTool = () => LOOKUP_TOOL;

  const client = {
    streamMessage: (
      _messages: unknown,
      options?: { tools?: Array<{ name?: string }> }
    ) => {
      names = (options?.tools ?? []).map((t) => String(t.name ?? ''));
      return createTestLlmStream([{ content: 'ok' }]);
    },
    getBaseUrl: () => 'http://localhost:test',
    getProviderId: () => 'test-provider',
  };
  patched.getClientForModel = () => client;
  patched.getLLMClient = () => client;

  for await (const _chunk of runStreamMessage(host, '测试', {
    metadata: { taskType: 'alwayson_discovery' },
  })) {
    // 只消费流，断言在收尾后做
  }
  return names;
}

describe('FIX-12 session_lookup 注入顺序', () => {
  it('分页切窗：取回工具进入最终工具面，同时任务裁剪仍然生效', async () => {
    const names = await runAndCaptureTools(true);
    expect(names).toContain('file_read');
    expect(names).toContain('session_lookup');
    // 裁剪本身未被削弱（computer_use 不在 alwayson_discovery 白名单）
    expect(names).not.toContain('computer_use');
  });

  it('未切窗：不注入 session_lookup', async () => {
    const names = await runAndCaptureTools(false);
    expect(names).toContain('file_read');
    expect(names).not.toContain('session_lookup');
  });
});
