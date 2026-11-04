/**
 * P1-2（2026-11-04）：压缩时「结构化事实」抽取/渲染（纯函数）回归。
 *
 * 要防的退化：低保留折叠（实测 ratio 0.007）把文件路径与命令一起压没了，
 * 长会话只能重新探索。本用例锁三件事：
 *   ① 只从 `tool_calls` 的结构化入参抽取（不解析自由文本，CS02）；
 *   ② 路径键取 `PATH_ARG_KEYS` 单一事实源；命令仅 shell 类工具；
 *   ③ 渲染有上限、已出现在摘要里的事实不重复追加、空事实返回空串。
 */
import { describe, it, expect } from 'bun:test';
import type { ChatMessage } from '../../src/ai/models/types';
import {
  STRUCTURED_FACTS_MAX_PATHS,
  STRUCTURED_FACT_VALUE_MAX_CHARS,
  extractStructuredFacts,
  renderStructuredFactsBlock,
} from '../../src/context/compaction/structuredFacts';

function call(name: string, args: Record<string, unknown>): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: `tc-${name}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

describe('P1-2：结构化事实抽取', () => {
  it('路径取 PATH_ARG_KEYS（file_path / path 等），命令仅取 shell 类工具', () => {
    const facts = extractStructuredFacts([
      call('file_write', { file_path: 'E:\\repo\\src\\a.ts' }),
      call('bash', { command: 'npm test -- --watch=false' }),
      call('code_run', { script: 'print(1)' }),
      // 非 shell 工具即使带 command 键，也不算"执行过的命令"
      call('music_generate', { command: 'not-a-shell-command' }),
    ]);
    expect(facts.paths).toContain('E:\\repo\\src\\a.ts');
    expect(facts.commands).toContain('npm test -- --watch=false');
    expect(facts.commands).toContain('print(1)');
    expect(facts.commands).not.toContain('not-a-shell-command');
  });

  it('自由文本里的"像路径的字符串"不被当作事实（只读结构化入参）', () => {
    const facts = extractStructuredFacts([
      {
        role: 'user',
        content: '请参考 C:\\repo\\secret.ts 与 src/utils/a.ts 这两个文件',
      },
    ]);
    expect(facts.paths).toEqual([]);
    expect(facts.commands).toEqual([]);
  });

  it('非法 JSON / 空入参 ⇒ 跳过该调用，不臆造', () => {
    const facts = extractStructuredFacts([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'x',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":' },
          },
          {
            id: 'y',
            type: 'function',
            function: { name: 'file_read', arguments: '[]' },
          },
        ],
      },
    ]);
    expect(facts).toEqual({ paths: [], commands: [] });
  });

  it('去重 + 上限 + 长值截断', () => {
    const longPath = `E:\\repo\\${'a'.repeat(400)}.ts`;
    const calls = Array.from(
      { length: STRUCTURED_FACTS_MAX_PATHS + 5 },
      (_, i) => call('file_read', { file_path: `E:\\repo\\f${i}.ts` })
    );
    const facts = extractStructuredFacts([
      call('file_read', { file_path: 'E:\\repo\\dup.ts' }),
      call('file_read', { file_path: 'E:\\repo\\dup.ts' }),
      call('file_read', { file_path: longPath }),
      ...calls,
    ]);
    expect(facts.paths.length).toBe(STRUCTURED_FACTS_MAX_PATHS);
    expect(facts.paths.filter((p) => p === 'E:\\repo\\dup.ts').length).toBe(1);
    const truncated = facts.paths.find((p) => p.startsWith('E:\\repo\\aaa'));
    expect(truncated?.length).toBe(STRUCTURED_FACT_VALUE_MAX_CHARS + 1); // 含省略号
    expect(truncated?.endsWith('…')).toBe(true);
  });
});

describe('P1-2：结构化事实渲染', () => {
  it('空事实 ⇒ 空串（调用方据此不追加，摘要逐字不变）', () => {
    expect(renderStructuredFactsBlock({ paths: [], commands: [] })).toBe('');
  });

  it('渲染为带标题的 Markdown 片段', () => {
    const block = renderStructuredFactsBlock({
      paths: ['E:\\repo\\a.ts'],
      commands: ['npm test'],
    });
    expect(block).toContain('【结构化事实（压缩时原样保留）】');
    expect(block).toContain('- E:\\repo\\a.ts');
    expect(block).toContain('- npm test');
  });

  it('摘要里已出现的事实不重复追加；全都有 ⇒ 不追加', () => {
    const facts = {
      paths: ['E:\\repo\\a.ts', 'E:\\repo\\b.ts'],
      commands: ['npm test'],
    };
    const partial = renderStructuredFactsBlock(facts, {
      alreadyPresentIn: '上一轮改了 E:\\repo\\a.ts',
    });
    expect(partial).not.toContain('E:\\repo\\a.ts');
    expect(partial).toContain('E:\\repo\\b.ts');

    const none = renderStructuredFactsBlock(facts, {
      alreadyPresentIn: 'E:\\repo\\a.ts 与 E:\\repo\\b.ts，命令 npm test',
    });
    expect(none).toBe('');
  });
});
