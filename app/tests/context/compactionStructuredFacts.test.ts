/**
 * P1-2（2026-11-04）：Tier3 折叠「低保留 ⇒ 补结构化事实」端到端回归。
 *
 * 实测退化：`compaction:low_retention` ratio 0.007（2172 → 16）—— 整批历史被压成
 * 极短摘要，文件路径/命令一起丢失。本用例驱动真实的 `runFullCompaction` 折叠循环
 * （注入 mock aiService），锁住两条：
 *   ① 保留度不达标 ⇒ 摘要后补「结构化事实」，路径与命令仍在压缩结果里；
 *   ② 摘要已保留这些事实 ⇒ 不重复追加（零噪声，行为与改造前一致）。
 */
import { describe, it, expect } from 'bun:test';
import type { ChatMessage } from '../../src/ai/models/types';
import { CompactionOrchestrator } from '../../src/context/compaction/CompactionOrchestrator';

type RunFull = (
  messages: ChatMessage[],
  ctx: { model: string; sessionId?: string }
) => Promise<{ messages: ChatMessage[]; applied: boolean }>;

const runFull = (orch: CompactionOrchestrator): RunFull =>
  (orch as unknown as { runFullCompaction: RunFull }).runFullCompaction.bind(
    orch
  );

function user(content: string): ChatMessage {
  return { role: 'user', content };
}

function toolWrite(path: string): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: `tc-${path.length}`,
        type: 'function',
        function: {
          name: 'file_write',
          arguments: JSON.stringify({ file_path: path }),
        },
      },
    ],
  };
}

function toolBash(command: string): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: `tc-cmd-${command.length}`,
        type: 'function',
        function: { name: 'bash', arguments: JSON.stringify({ command }) },
      },
    ],
  };
}

/** 掺入大量可辨识实体（点分/snake_case/URL）⇒ 短摘要必然低保留 */
function noisyUser(): ChatMessage {
  return user(
    'alpha.beta gamma.delta env_var_name SOME_CONST_1 http://example.com/x '.repeat(
      40
    )
  );
}

const head: ChatMessage = { role: 'system', content: '你是助手。' };
const targetPath = 'E:\\repo\\src\\target.ts';
const command = 'npm test -- --watch=false';

function history(): ChatMessage[] {
  return [
    noisyUser(),
    toolWrite(targetPath),
    toolBash(command),
    ...Array.from({ length: 3 }, (_, i) => user(`第 ${i + 2} 轮补充`)),
  ];
}

describe('P1-2：低保留折叠补结构化事实', () => {
  it('摘要丢失实体 ⇒ 压缩结果里仍能检索到路径与命令', async () => {
    // 极短摘要：不含任何原文实体 ⇒ 保留度 ratio 远低于 0.4
    const orch = new CompactionOrchestrator({
      aiService: { generate: async () => ({ content: '短摘要' }) },
    });
    const result = await runFull(orch)([head, ...history()], {
      model: 'm',
      sessionId: 's',
    });

    expect(result.applied).toBe(true);
    const joined = result.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('【结构化事实（压缩时原样保留）】');
    expect(joined).toContain(targetPath);
    expect(joined).toContain(command);
  });

  it('摘要已保留这些事实 ⇒ 不重复追加（零噪声）', async () => {
    const orch = new CompactionOrchestrator({
      aiService: {
        generate: async () => ({
          content: `alpha.beta gamma.delta env_var_name SOME_CONST_1 http://example.com/x ${targetPath} ${command}`,
        }),
      },
    });
    const result = await runFull(orch)([head, ...history()], {
      model: 'm',
      sessionId: 's',
    });

    expect(result.applied).toBe(true);
    const joined = result.messages.map((m) => m.content).join('\n');
    expect(joined).not.toContain('【结构化事实');
  });
});
