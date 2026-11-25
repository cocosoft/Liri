/**
 * P2-2（2026-11-25）：轮末自动提取记忆的接线与门禁。
 *
 * 覆盖：门禁关闭零写入 · 开启后按 `createMemory({content, metadata})` 契约写入 ·
 * 工具块分支回归（原实现传错形状，接线后必失败）。
 */
import { describe, expect, it } from 'bun:test';
import {
  createMemoryExtractionHook,
  maybeExtractTurnMemories,
} from '../../src/hooks/postSampling/MemoryExtractionHook';

function makeStubManager(): {
  calls: Array<{ content: string; metadata: Record<string, any> }>;
  createMemory: (memory: {
    content: string;
    metadata: Record<string, any>;
  }) => Promise<{ id: string }>;
} {
  const calls: Array<{ content: string; metadata: Record<string, any> }> = [];
  return {
    calls,
    createMemory: async (memory) => {
      calls.push(memory);
      return { id: `stub_${calls.length}` };
    },
  };
}

describe('轮末自动提取（P2-2 接线）', () => {
  it('门禁关闭 ⇒ 零写入（默认不改变既有行为）', async () => {
    const stub = makeStubManager();
    await maybeExtractTurnMemories(
      {
        userContent:
          'Always use bun instead of npm because lockfile drift breaks CI.',
        assistantContent: '好的',
        sessionId: 's1',
      },
      { enabled: false, memoryManager: stub }
    );
    expect(stub.calls).toHaveLength(0);
  });

  it('门禁开启 ⇒ 按 createMemory 契约写入并带会话信息', async () => {
    const stub = makeStubManager();
    await maybeExtractTurnMemories(
      {
        userContent:
          'Always use bun instead of npm because lockfile drift breaks CI.',
        assistantContent: '好的，已记录。',
        sessionId: 's1',
      },
      { enabled: true, memoryManager: stub }
    );

    expect(stub.calls.length).toBeGreaterThan(0);
    for (const call of stub.calls) {
      expect(typeof call.content).toBe('string');
      expect(call.content.length).toBeGreaterThan(0);
      expect(call.metadata.name).toBeTruthy();
      expect(call.metadata.type).toBeTruthy();
      expect(call.metadata.sessionId).toBe('s1');
      // 回归：不得再传 {type, toolName, input, timestamp} 旧形状
      expect(call.metadata).not.toHaveProperty('toolName');
    }
  });

  it('工具块分支：写入 {content, metadata}（原实现传错形状必失败）', async () => {
    const stub = makeStubManager();
    const hook = createMemoryExtractionHook(stub);
    await hook({
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'file_write',
              input: { file_path: 'README.md', content: '文档内容' },
            },
          ],
        },
      ],
      toolUseContext: { sessionId: 's2' },
    } as never);

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].content).toBe('文档内容');
    expect(stub.calls[0].metadata.type).toBe('tool_use');
    expect(stub.calls[0].metadata.sessionId).toBe('s2');
  });
});
