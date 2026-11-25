/**
 * P1-2（2026-11-25）recall_memory 检索范围/类型参数单测。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P1-2
 * 覆盖：auto 保持旧行为 · scope=global 可跨会话 · scope=all 合并 · type 过滤 ·
 * 无会话上下文时如实提示 · 无 query 返回会话上下文。
 */
import { describe, expect, it } from 'bun:test';
import { RecallMemoryTool } from '@openliri/tool-agent';
import type { ToolUseContext } from '@openliri/infra/utils/toolContract/ToolUseContext';

const CTX = { sessionId: 'sess-1' } as unknown as ToolUseContext;
const NO_CTX = {} as unknown as ToolUseContext;

function makeTool(): ReturnType<typeof RecallMemoryTool.create> {
  return RecallMemoryTool.create({
    resolveSessionMemory: async () => ({
      searchMemory: async () => [
        { content: 'S 决策条目', type: 'decision' },
        { content: 'S 文件变更', type: 'file_change' },
      ],
      getMemoryContext: () => 'SESSION-CONTEXT',
    }),
    resolveGlobalMemory: async () => ({
      getRelevantMemories: async () => [
        {
          content: 'G 决策条目',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          metadata: { type: 'decision' },
        },
        {
          content: 'G 用户事实',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          metadata: { type: 'user_fact' },
        },
      ],
    }),
  });
}

async function run(
  input: Record<string, unknown>,
  context: ToolUseContext
): Promise<string> {
  const result = await makeTool().execute(input, context);
  return String(result.data ?? '');
}

describe('recall_memory scope/type（P1-2）', () => {
  it('默认 auto + 有会话上下文 ⇒ 只查会话（旧行为）', async () => {
    const text = await run({ query: '部署' }, CTX);
    expect(text).toContain('S 决策条目');
    expect(text).not.toContain('G 决策条目');
  });

  it('scope=global ⇒ 有会话上下文也能跨会话检索', async () => {
    const text = await run({ query: '部署', scope: 'global' }, CTX);
    expect(text).toContain('G 决策条目');
    expect(text).not.toContain('S 决策条目');
  });

  it('scope=all ⇒ 会话在前、全局在后合并', async () => {
    const text = await run({ query: '部署', scope: 'all' }, CTX);
    expect(text).toContain('S 决策条目');
    expect(text).toContain('G 决策条目');
    expect(text.indexOf('S 决策条目')).toBeLessThan(text.indexOf('G 决策条目'));
  });

  it('检索失败 ⇒ 如实提示"检索失败"而非"未找到"（2026-11-25 第 3 批）', async () => {
    const tool = RecallMemoryTool.create({
      resolveSessionMemory: async () => {
        throw new Error('boom');
      },
    });
    const result = await tool.execute({ query: '部署', scope: 'session' }, CTX);
    const text = String(result.data ?? '');
    expect(text).toContain('检索失败');
    expect(text).toContain('session-search-failed');
    expect(text).not.toContain('未找到相关记忆');
  });

  it('type 过滤 ⇒ 只保留指定类型', async () => {
    const text = await run(
      { query: '部署', scope: 'all', type: 'decision' },
      CTX
    );
    expect(text).toContain('S 决策条目');
    expect(text).toContain('G 决策条目');
    expect(text).not.toContain('S 文件变更');
    expect(text).not.toContain('G 用户事实');
  });

  it('scope=session 但无会话上下文 ⇒ 如实提示可用 global', async () => {
    const text = await run({ query: '部署', scope: 'session' }, NO_CTX);
    expect(text).toContain('无会话上下文');
    expect(text).toContain('scope="global"');
  });

  it('无 query + 有会话上下文 ⇒ 返回会话记忆上下文（旧行为）', async () => {
    const text = await run({}, CTX);
    expect(text).toContain('SESSION-CONTEXT');
  });

  it('scope=team ⇒ 查团队记忆（source=team）', async () => {
    const tool = RecallMemoryTool.create({
      resolveTeamMemory: async () => ({
        search: async () => [
          { content: 'T 团队记录', timestamp: '', type: 'decision' },
        ],
      }),
    });
    const result = await tool.execute({ query: '部署', scope: 'team' }, CTX);
    const text = String(result.data ?? '');
    expect(text).toContain('T 团队记录');
    expect(text).toContain('来源:team');
  });

  it('记忆零命中 + transcript ⇒ 回退提示与事件引用', async () => {
    const tool = RecallMemoryTool.create({
      resolveSessionMemory: async () => ({
        searchMemory: async () => [],
        getMemoryContext: () => '',
      }),
      searchTranscript: async () => [
        {
          entries: [
            {
              role: 'user',
              content: '原始记录内容',
              timestamp: 1_700_000_000_000,
              lastEventSeq: 7,
            },
          ],
        },
      ],
    });
    const result = await tool.execute({ query: '部署' }, CTX);
    const text = String(result.data ?? '');
    expect(text).toContain('来源:transcript');
    expect(text).toContain('事件#7');
    expect(text).toContain('原始记录内容');

    const messages = (
      result as unknown as { newMessages?: Array<{ content?: string }> }
    ).newMessages;
    expect(messages?.[0]?.content ?? '').toContain('回退到原始会话记录');
  });
});
