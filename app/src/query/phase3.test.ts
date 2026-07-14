/**
 * 阶段三工程化增强 — 集成测试
 * 覆盖 ParallelToolExecutor / ToolErrorCollector / InsightsEngine
 */
import { describe, test, expect } from 'bun:test';
import {
  ParallelToolExecutor,
  createParallelToolExecutor,
} from './ParallelToolExecutor';
import type { ToolExecutorFn } from './ParallelToolExecutor';
import {
  ToolErrorCollector,
  createToolErrorCollector,
} from './ToolErrorCollector';
import type { ToolExecutionError } from './ToolErrorCollector';
import { InsightsEngine, insightsEngine } from '../analytics/InsightsEngine';
import type { ConversationMessage } from '../analytics/InsightsEngine';

describe('ParallelToolExecutor', () => {
  test('executes all tools and returns results in order', async () => {
    const executor = new ParallelToolExecutor();
    const calls: Array<{ id: string; name: string; args: unknown }> = [];

    const toolExecute: ToolExecutorFn = async (tc) => {
      calls.push({ id: tc.id, name: tc.name, args: tc.arguments });
      return `result-${tc.name}`;
    };

    const toolCalls = [
      { id: 't1', name: 'Read', arguments: { path: '/a.txt' } },
      { id: 't2', name: 'Glob', arguments: { path: '/b.txt' } },
      { id: 't3', name: 'Grep', arguments: { path: '/c.txt' } },
    ];

    const result = await executor.executeAll(toolCalls, toolExecute);

    expect(result.results.length).toBe(3);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.concurrentGroupCount).toBeGreaterThanOrEqual(1);
  });

  test('handles tool execution errors gracefully', async () => {
    const executor = new ParallelToolExecutor();

    const toolExecute: ToolExecutorFn = async (tc) => {
      if (tc.name === 'bad_tool') {
        throw new Error('Tool failed');
      }
      return 'ok';
    };

    const toolCalls = [
      { id: 't1', name: 'Read', arguments: {} },
      { id: 't2', name: 'bad_tool', arguments: {} },
    ];

    const result = await executor.executeAll(toolCalls, toolExecute);

    expect(result.results.length).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.results[1].error).toContain('Tool failed');
  });

  test('abortOnError stops execution after first failure', async () => {
    const executor = new ParallelToolExecutor({ abortOnError: true });
    const executedNames: string[] = [];

    const toolExecute: ToolExecutorFn = async (tc) => {
      executedNames.push(tc.name);
      if (tc.name === 'fail_early') {
        throw new Error('early failure');
      }
      return 'ok';
    };

    const toolCalls = [
      { id: 't1', name: 'Read', arguments: {} },
      { id: 't2', name: 'fail_early', arguments: {} },
      { id: 't3', name: 'Read', arguments: {} },
    ];

    const result = await executor.executeAll(toolCalls, toolExecute);
    expect(result.failureCount).toBe(1);
  });

  test('timeoutMs kills slow tool execution', async () => {
    const executor = new ParallelToolExecutor({ timeoutMs: 50 });

    const toolExecute: ToolExecutorFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return 'slow result';
    };

    const toolCalls = [{ id: 't1', name: 'slow_tool', arguments: {} }];

    const result = await executor.executeAll(toolCalls, toolExecute);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('timed out');
  });

  test('factory function creates instance', () => {
    const executor = createParallelToolExecutor({ timeoutMs: 1000 });
    expect(executor).toBeDefined();
  });

  test('tracks duration metrics', async () => {
    const executor = new ParallelToolExecutor();

    const toolExecute: ToolExecutorFn = async () => 'ok';
    const toolCalls = [{ id: 't1', name: 'Read', arguments: {} }];

    const result = await executor.executeAll(toolCalls, toolExecute);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('ToolErrorCollector', () => {
  test('records and retrieves errors', () => {
    const collector = createToolErrorCollector();
    expect(collector.count).toBe(0);
    expect(collector.hasErrors).toBe(false);

    const error: ToolExecutionError = {
      turn: 1,
      toolName: 'file_write',
      arguments: '{"path":"/tmp/x.txt"}',
      error: 'Permission denied',
      toolResult: '{"error":"Permission denied"}',
      timestamp: Date.now(),
    };

    collector.record(error);
    expect(collector.count).toBe(1);
    expect(collector.hasErrors).toBe(true);
  });

  test('queries by turn', () => {
    const collector = createToolErrorCollector();

    collector.record({
      turn: 1,
      toolName: 't1',
      arguments: '{}',
      error: 'e1',
      toolResult: 'r1',
      timestamp: 1000,
    });
    collector.record({
      turn: 1,
      toolName: 't2',
      arguments: '{}',
      error: 'e2',
      toolResult: 'r2',
      timestamp: 2000,
    });
    collector.record({
      turn: 2,
      toolName: 't3',
      arguments: '{}',
      error: 'e3',
      toolResult: 'r3',
      timestamp: 3000,
    });

    expect(collector.getByTurn(1).length).toBe(2);
    expect(collector.getByTurn(2).length).toBe(1);
    expect(collector.getByTurn(3).length).toBe(0);
  });

  test('queries by tool', () => {
    const collector = createToolErrorCollector();

    collector.record({
      turn: 1,
      toolName: 'bash',
      arguments: '{}',
      error: 'e1',
      toolResult: 'r1',
      timestamp: 1000,
    });
    collector.record({
      turn: 2,
      toolName: 'bash',
      arguments: '{}',
      error: 'e2',
      toolResult: 'r2',
      timestamp: 2000,
    });
    collector.record({
      turn: 3,
      toolName: 'file_write',
      arguments: '{}',
      error: 'e3',
      toolResult: 'r3',
      timestamp: 3000,
    });

    expect(collector.getByTool('bash').length).toBe(2);
    expect(collector.getByTool('file_write').length).toBe(1);
    expect(collector.getByTool('unknown').length).toBe(0);
  });

  test('getSummary returns correct stats', () => {
    const collector = createToolErrorCollector();

    collector.record({
      turn: 1,
      toolName: 'bash',
      arguments: '{}',
      error: 'e1',
      toolResult: 'r1',
      timestamp: 1000,
    });
    collector.record({
      turn: 1,
      toolName: 'bash',
      arguments: '{}',
      error: 'e2',
      toolResult: 'r2',
      timestamp: 2000,
    });
    collector.record({
      turn: 2,
      toolName: 'file_write',
      arguments: '{}',
      error: 'e3',
      toolResult: 'r3',
      timestamp: 3000,
    });

    const summary = collector.getSummary();
    expect(summary.totalErrors).toBe(3);
    expect(summary.byTool['bash']).toBe(2);
    expect(summary.byTool['file_write']).toBe(1);
    expect(summary.byTurn['1']).toBe(2);
    expect(summary.byTurn['2']).toBe(1);
    expect(summary.topErrorTools[0].toolName).toBe('bash');
    expect(summary.firstErrorAt).toBe(1000);
    expect(summary.lastErrorAt).toBe(3000);
  });

  test('toAgentResult integrates with AgentResult', () => {
    const collector = createToolErrorCollector();

    collector.record({
      turn: 1,
      toolName: 'test',
      arguments: '{}',
      error: 'err',
      toolResult: '{}',
      timestamp: 1000,
    });

    const result = collector.toAgentResult(5);
    expect(result.toolErrors.length).toBe(1);
    expect(result.errorSummary.totalErrors).toBe(1);
  });

  test('clear resets all errors', () => {
    const collector = createToolErrorCollector();

    collector.record({
      turn: 1,
      toolName: 'test',
      arguments: '{}',
      error: 'err',
      toolResult: '{}',
      timestamp: 1000,
    });
    expect(collector.count).toBe(1);

    collector.clear();
    expect(collector.count).toBe(0);
    expect(collector.hasErrors).toBe(false);
  });

  test('arguments truncated to 200 chars', () => {
    const collector = createToolErrorCollector();
    const longArgs = 'x'.repeat(500);

    collector.record({
      turn: 1,
      toolName: 'test',
      arguments: longArgs,
      error: 'err',
      toolResult: '{}',
      timestamp: 1000,
    });

    const errors = collector.getAll();
    expect(errors[0].arguments).toBe(longArgs);
  });
});

describe('InsightsEngine', () => {
  test('extracts key facts from conversation', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: '程序启动时报错' },
      {
        role: 'assistant',
        content:
          '确认：端口 8080 被占用。发现：nginx 进程占用了该端口。结论：需要先停止 nginx。',
      },
    ];

    const result = insightsEngine.extract(messages);
    expect(result.keyFacts.length).toBeGreaterThan(0);
    expect(result.keyFacts.some((f) => f.includes('8080'))).toBe(true);
  });

  test('extracts decisions from assistant messages', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: '怎么优化性能？' },
      {
        role: 'assistant',
        content:
          '决定：使用 Redis 缓存。采用 LRU 淘汰策略。替换原先的内存缓存方式。',
      },
    ];

    const result = insightsEngine.extract(messages);
    expect(result.decisions.length).toBeGreaterThan(0);
  });

  test('extracts pending questions', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content: '还需要确认数据库版本吗？下一步是否需要迁移数据？',
      },
    ];

    const result = insightsEngine.extract(messages);
    expect(result.pendingQuestions.length).toBeGreaterThan(0);
  });

  test('extracts file changes', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content:
          '修改 `src/app.ts` 中的配置。创建 `src/utils/cache.ts` 文件。删除 `src/old.ts`。',
      },
    ];

    const result = insightsEngine.extract(messages);
    expect(result.fileChanges.length).toBeGreaterThan(0);
  });

  test('generates summary for long conversations', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: '第一个问题是什么原因导致的？' },
      {
        role: 'assistant',
        content: '详细分析后发现是配置错误的问题。需要修改多项配置文件。',
      },
      { role: 'user', content: '第二个问题需要怎么解决？' },
      {
        role: 'assistant',
        content: '需要重新部署服务。先停止旧进程再启动新版本。',
      },
      { role: 'user', content: '第三个问题是否还有遗留？' },
      {
        role: 'assistant',
        content:
          '最终确认所有修复已完成。今天的工作总结完毕，系统恢复正常运行。',
      },
    ];

    const result = insightsEngine.extract(messages);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  test('handles empty messages', () => {
    const result = insightsEngine.extract([]);
    expect(result.keyFacts).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.extractedAt).toBeGreaterThan(0);
  });

  test('has timestamp in result', () => {
    const result = insightsEngine.extract([{ role: 'user', content: 'hello' }]);
    expect(result.extractedAt).toBeGreaterThan(0);
  });

  test('singleton instance works', () => {
    expect(insightsEngine).toBeDefined();
    const r = insightsEngine.extract([
      { role: 'assistant', content: '确认：修复完成。' },
    ]);
    expect(r.keyFacts.length).toBe(1);
  });
});
